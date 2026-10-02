import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Message } from '@arco-design/web-react';
import {
  DEFAULT_MESSAGE_PAGE_LIMIT,
  loadConversationMessagePage,
  loadFirstConversationMessages,
  loadLatestConversationMessages,
} from '@/renderer/utils/chat/messagePagination';
import {
  normalizeDbMessage,
  prepareNavigationLiveBuffer,
  useMessageList,
  useMessagePaginationState,
  useUpdateMessageList,
  useUpdateMessageListLoading,
  useUpdateMessagePaginationState,
} from '../hooks';
import { useHistoryRequestScope } from '../historyScope';
import { appendHistoryPage, historyMessageKey, replaceHistoryWindow } from './historyWindow';

/** Fetch one bounded endpoint window, then continue through adjacent cursor pages. */
export function useHistoryNavigation(conversationId?: string) {
  const scopeRef = useHistoryRequestScope(conversationId);
  const list = useMessageList();
  const listRef = useRef(list);
  listRef.current = list;
  const pagination = useMessagePaginationState();
  const update = useUpdateMessageList();
  const setLoading = useUpdateMessageListLoading();
  const setPagination = useUpdateMessagePaginationState();
  const { t } = useTranslation();
  const [isJumping, setIsJumping] = useState(false);
  const [isLoadingAfter, setIsLoadingAfter] = useState(false);
  const busy = useRef<{ epoch: number; kind: 'jump' | 'after' } | null>(null);
  useEffect(() => {
    busy.current = null;
    setIsJumping(false);
    setIsLoadingAfter(false);
  }, [conversationId, scopeRef]);
  useEffect(() => {
    if (busy.current && busy.current.epoch !== scopeRef.current.epoch) {
      busy.current = null;
      setIsJumping(false);
      setIsLoadingAfter(false);
    }
  }, [pagination, scopeRef]);

  const jump = useCallback(
    async (endpoint: 'first' | 'latest'): Promise<boolean> => {
      const scope = scopeRef.current;
      if (
        !conversationId ||
        !scope.active ||
        scope.conversationId !== conversationId ||
        (busy.current?.kind === 'jump' && busy.current.epoch === scope.epoch)
      )
        return false;
      const epoch = ++scope.epoch;
      scope.navigationEpoch = epoch;
      const snapshot = new Map(listRef.current.map((message) => [historyMessageKey(message), message]));
      scope.navigationLiveBuffer = prepareNavigationLiveBuffer(scope, listRef.current, epoch);
      busy.current = { epoch, kind: 'jump' };
      setIsJumping(true);
      setIsLoadingAfter(false);
      setLoading(false);
      setPagination((current) => ({ ...current, isLoadingBefore: false, isLoadingAnchor: false }));
      const current = () =>
        scopeRef.current === scope && scope.active && scope.epoch === epoch && scope.conversationId === conversationId;
      try {
        const load = endpoint === 'first' ? loadFirstConversationMessages : loadLatestConversationMessages;
        const page = await load(conversationId, { limit: DEFAULT_MESSAGE_PAGE_LIMIT, contentMode: 'compact' });
        if (!current()) return false;
        scope.window = page.has_more_after ? endpoint : 'latest';
        const transitionToLatest = endpoint === 'latest' || !page.has_more_after;
        const liveBuffer =
          transitionToLatest && scope.navigationLiveBuffer?.epoch === epoch ? scope.navigationLiveBuffer : undefined;
        update((messages) => {
          if (!current()) return messages;
          if (liveBuffer) liveBuffer.applied = true;
          return replaceHistoryWindow(
            conversationId,
            page.items.map(normalizeDbMessage),
            liveBuffer?.messages ?? messages,
            transitionToLatest ? snapshot : undefined
          );
        });
        setPagination((state) =>
          current()
            ? {
                oldestCursor: page.oldest_cursor ?? undefined,
                newestCursor: page.newest_cursor ?? undefined,
                hasMoreBefore: page.has_more_before,
                hasMoreAfter: page.has_more_after,
                isLoadingBefore: false,
                isLoadingAnchor: false,
              }
            : state
        );
        return true;
      } catch {
        if (current()) {
          Message.error(t('messages.historyNavigationFailed'));
        }
        return false;
      } finally {
        if (scope.navigationEpoch === epoch) scope.navigationEpoch = undefined;
        if (scope.navigationLiveBuffer?.epoch === epoch) delete scope.navigationLiveBuffer;
        if (scopeRef.current === scope && scope.active && busy.current?.epoch === epoch) {
          busy.current = null;
          setIsJumping(false);
        }
      }
    },
    [conversationId, scopeRef, setPagination, setLoading, t, update]
  );

  const loadNextPage = useCallback(async (): Promise<boolean> => {
    const scope = scopeRef.current;
    if (
      !conversationId ||
      !scope.active ||
      scope.conversationId !== conversationId ||
      busy.current ||
      !pagination.hasMoreAfter ||
      !pagination.newestCursor ||
      pagination.isLoadingBefore ||
      pagination.isLoadingAnchor
    )
      return false;
    const epoch = ++scope.epoch;
    scope.navigationEpoch = epoch;
    const snapshot = new Map(listRef.current.map((message) => [historyMessageKey(message), message]));
    scope.navigationLiveBuffer = prepareNavigationLiveBuffer(scope, listRef.current, epoch);
    busy.current = { epoch, kind: 'after' };
    setIsLoadingAfter(true);
    const current = () =>
      scopeRef.current === scope && scope.active && scope.epoch === epoch && scope.conversationId === conversationId;
    try {
      const page = await loadConversationMessagePage(conversationId, {
        limit: DEFAULT_MESSAGE_PAGE_LIMIT,
        contentMode: 'compact',
        after: pagination.newestCursor,
      });
      if (!current()) return false;
      if (!page.has_more_after) scope.window = 'latest';
      const liveBuffer =
        !page.has_more_after && scope.navigationLiveBuffer?.epoch === epoch ? scope.navigationLiveBuffer : undefined;
      update((messages) => {
        if (!current()) return messages;
        if (liveBuffer) liveBuffer.applied = true;
        return replaceHistoryWindow(
          conversationId,
          appendHistoryPage(conversationId, messages, page.items.map(normalizeDbMessage)),
          liveBuffer?.messages ?? messages,
          liveBuffer ? snapshot : undefined
        );
      });
      setPagination((state) =>
        current()
          ? {
              ...state,
              newestCursor: page.newest_cursor ?? state.newestCursor,
              hasMoreAfter: page.has_more_after,
            }
          : state
      );
      return true;
    } catch {
      if (current()) Message.error(t('messages.historyNavigationFailed'));
      return false;
    } finally {
      if (scope.navigationEpoch === epoch) scope.navigationEpoch = undefined;
      if (scope.navigationLiveBuffer?.epoch === epoch) delete scope.navigationLiveBuffer;
      if (scopeRef.current === scope && scope.active && busy.current?.epoch === epoch) {
        busy.current = null;
        setIsLoadingAfter(false);
      }
    }
  }, [conversationId, pagination, scopeRef, setPagination, t, update]);

  return {
    jump,
    loadNextPage,
    isJumping,
    isLoadingAfter,
    requestScope: scopeRef,
    isBusy: () => busy.current !== null && busy.current.epoch === scopeRef.current.epoch,
  };
}

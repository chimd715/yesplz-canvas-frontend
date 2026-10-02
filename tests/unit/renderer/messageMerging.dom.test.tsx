/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { type PropsWithChildren } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcBridge } from '@/common';
import type { IMessageAcpToolCall, IMessageText, IMessageThinking, TMessage } from '@/common/chat/chatLib';
import type { MessageCursorPage } from '@/common/adapter/ipcBridge';
import {
  useHistoryRequestScope,
  usePendingConfirmationsRecovery,
} from '@/renderer/pages/conversation/Messages/historyScope';
import {
  MessageListLoadingProvider,
  MessageListProvider,
  MessagePaginationProvider,
  useAddOrUpdateMessage,
  useMessageLstCache,
  useMessageList,
  useReplaceWithAnchorWindow,
  useLoadPreviousMessagePage,
  useLoadAnchorMessageWindow,
  useMessagePaginationState,
  useMessageListLoading,
  useUpdateMessageList,
  useUpdateMessagePaginationState,
} from '@/renderer/pages/conversation/Messages/hooks';

const auth = vi.hoisted(() => ({ id: 'test-user' as string | null }));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: auth.id ? { id: auth.id } : null, status: auth.id ? 'authenticated' : 'unauthenticated' }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      confirmation: {
        list: { invoke: vi.fn().mockResolvedValue([]) },
        remove: { on: vi.fn().mockReturnValue(() => {}) },
      },
      userCreated: {
        on: vi.fn().mockReturnValue(() => {}),
      },
      statusChanged: {
        on: vi.fn().mockReturnValue(() => {}),
      },
      turnCompleted: {
        on: vi.fn().mockReturnValue(() => {}),
      },
    },
    database: {
      getConversationMessages: {
        invoke: vi.fn(),
      },
    },
  },
}));

const CONVERSATION_ID = 'conversation-1';

function createTextMessage(msgId: string, content: string): IMessageText {
  return {
    id: `text-${msgId}-${content}`,
    type: 'text',
    msg_id: msgId,
    conversation_id: CONVERSATION_ID,
    position: 'left',
    content: {
      content,
    },
  };
}

function createThinkingMessage(msgId: string, content: string): IMessageThinking {
  return {
    id: `thinking-${msgId}-${content}`,
    type: 'thinking',
    msg_id: msgId,
    conversation_id: CONVERSATION_ID,
    position: 'left',
    content: {
      content,
      status: 'thinking',
    },
  };
}

function createThinkingDoneMessage(msgId: string, duration: number): IMessageThinking {
  return {
    id: `thinking-done-${msgId}`,
    type: 'thinking',
    msg_id: msgId,
    conversation_id: CONVERSATION_ID,
    position: 'left',
    content: {
      content: '',
      duration,
      status: 'done',
    },
  };
}

function createToolCallMessage(toolCallId: string): IMessageAcpToolCall {
  return {
    id: toolCallId,
    type: 'acp_tool_call',
    msg_id: toolCallId,
    conversation_id: CONVERSATION_ID,
    position: 'left',
    content: {
      session_id: 'session-1',
      update: {
        sessionUpdate: 'tool_call',
        tool_call_id: toolCallId,
        status: 'completed',
        title: 'Read file',
        kind: 'read',
      },
    },
  };
}

function TestWrapper({ children }: PropsWithChildren): JSX.Element {
  return <MessageListProvider value={[]}>{children}</MessageListProvider>;
}

function CacheWrapper({ children }: PropsWithChildren): JSX.Element {
  return (
    <MessageListLoadingProvider value={false}>
      <MessagePaginationProvider
        value={{ hasMoreBefore: false, hasMoreAfter: false, isLoadingBefore: false, isLoadingAnchor: false }}
      >
        <MessageListProvider value={[]}>{children}</MessageListProvider>
      </MessagePaginationProvider>
    </MessageListLoadingProvider>
  );
}

function useMessageHarness() {
  return {
    addOrUpdateMessage: useAddOrUpdateMessage(),
    messages: useMessageList(),
  };
}

function useAnchorMessageHarness() {
  return {
    addOrUpdateMessage: useAddOrUpdateMessage(),
    replaceWithAnchorWindow: useReplaceWithAnchorWindow(),
    messages: useMessageList(),
  };
}

async function flushMessageQueue(): Promise<void> {
  await act(async () => {
    vi.runAllTimers();
  });
}

describe('message merging', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('keeps text segments split when tool calls interrupt the same msg_id stream', async () => {
    const { result } = renderHook(() => useMessageHarness(), {
      wrapper: TestWrapper,
    });

    act(() => {
      result.current.addOrUpdateMessage(createTextMessage('msg-1', 'hello'));
      result.current.addOrUpdateMessage(createTextMessage('msg-1', ' world'));
    });
    await flushMessageQueue();

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].type).toBe('text');
    expect((result.current.messages[0] as IMessageText).content.content).toBe('hello world');

    act(() => {
      result.current.addOrUpdateMessage(createToolCallMessage('tool-1'));
      result.current.addOrUpdateMessage(createTextMessage('msg-1', 'again'));
    });
    await flushMessageQueue();

    expect(result.current.messages.map((message) => message.type)).toEqual(['text', 'acp_tool_call', 'text']);
    expect((result.current.messages[0] as IMessageText).content.content).toBe('hello world');
    expect((result.current.messages[2] as IMessageText).content.content).toBe('again');
  });

  it('keeps thinking segments split when tool calls interrupt the same msg_id stream', async () => {
    const { result } = renderHook(() => useMessageHarness(), {
      wrapper: TestWrapper,
    });

    act(() => {
      result.current.addOrUpdateMessage(createThinkingMessage('msg-1', 'alpha'));
      result.current.addOrUpdateMessage(createThinkingMessage('msg-1', 'beta'));
    });
    await flushMessageQueue();

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].type).toBe('thinking');
    expect((result.current.messages[0] as IMessageThinking).content.content).toBe('alphabeta');

    act(() => {
      result.current.addOrUpdateMessage(createToolCallMessage('tool-1'));
      result.current.addOrUpdateMessage(createThinkingMessage('msg-1', 'gamma'));
    });
    await flushMessageQueue();

    expect(result.current.messages.map((message) => message.type)).toEqual(['thinking', 'acp_tool_call', 'thinking']);
    expect((result.current.messages[0] as IMessageThinking).content.content).toBe('alphabeta');
    expect((result.current.messages[2] as IMessageThinking).content.content).toBe('gamma');
  });

  it('merges thinking done updates into the existing thinking message instead of appending a completion message', async () => {
    const { result } = renderHook(() => useMessageHarness(), {
      wrapper: TestWrapper,
    });

    act(() => {
      result.current.addOrUpdateMessage(createThinkingMessage('msg-1', 'alpha'));
      result.current.addOrUpdateMessage(createToolCallMessage('tool-1'));
      result.current.addOrUpdateMessage(createThinkingDoneMessage('msg-1', 4200));
    });
    await flushMessageQueue();

    expect(result.current.messages.map((message) => message.type)).toEqual(['thinking', 'acp_tool_call']);
    expect((result.current.messages[0] as IMessageThinking).content.status).toBe('done');
    expect((result.current.messages[0] as IMessageThinking).content.duration).toBe(4200);
  });

  it('ignores non-renderable transformed stream messages', async () => {
    const { result } = renderHook(() => useMessageHarness(), {
      wrapper: TestWrapper,
    });

    act(() => {
      result.current.addOrUpdateMessage(undefined);
    });
    await flushMessageQueue();

    expect(result.current.messages).toEqual([]);
  });

  it('keeps richer overlapping streaming messages in a bounded anchor window', async () => {
    const { result } = renderHook(() => useAnchorMessageHarness(), {
      wrapper: TestWrapper,
    });

    act(() => {
      result.current.addOrUpdateMessage(createTextMessage('agent-1', 'partial streaming response'));
      result.current.addOrUpdateMessage(createTextMessage('agent-2', 'live tail'));
    });
    await flushMessageQueue();

    act(() => {
      result.current.replaceWithAnchorWindow(CONVERSATION_ID, [
        createTextMessage('user-anchor', 'anchor'),
        createTextMessage('agent-1', 'partial'),
      ]);
    });

    expect(result.current.messages.map((message) => message.msg_id)).toEqual(['user-anchor', 'agent-1']);
    expect((result.current.messages[1] as IMessageText).content.content).toBe('partial streaming response');
    expect(result.current.messages.some((message) => message.msg_id === 'agent-2')).toBe(false);
  });

  it('requests compact tool content when hydrating historical messages', async () => {
    const invoke = vi.mocked(ipcBridge.database.getConversationMessages.invoke);
    invoke.mockClear();
    invoke.mockResolvedValue({
      items: [],
      oldest_cursor: null,
      newest_cursor: null,
      has_more_before: false,
      has_more_after: false,
    });

    renderHook(() => useMessageLstCache(CONVERSATION_ID), {
      wrapper: CacheWrapper,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(invoke).toHaveBeenCalledWith({
      conversation_id: CONVERSATION_ID,
      limit: 50,
      content_mode: 'compact',
    });
  });

  it('flips a pending user message to finish when message.statusChanged arrives for it', async () => {
    const invoke = vi.mocked(ipcBridge.database.getConversationMessages.invoke);
    invoke.mockResolvedValue({
      items: [],
      oldest_cursor: null,
      newest_cursor: null,
      has_more_before: false,
      has_more_after: false,
    });

    let emitUserCreated: ((payload: any) => void) | undefined;
    let emitStatusChanged: ((payload: any) => void) | undefined;
    vi.mocked(ipcBridge.conversation.userCreated.on).mockImplementation((cb: any) => {
      emitUserCreated = cb;
      return () => {};
    });
    vi.mocked(ipcBridge.conversation.statusChanged.on).mockImplementation((cb: any) => {
      emitStatusChanged = cb;
      return () => {};
    });

    function useCacheAndListHarness() {
      useMessageLstCache(CONVERSATION_ID);
      return { messages: useMessageList() };
    }

    const { result } = renderHook(() => useCacheAndListHarness(), { wrapper: CacheWrapper });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      emitUserCreated?.({
        conversation_id: CONVERSATION_ID,
        msg_id: 'msg-midturn-1',
        client_msg_id: 'client-1',
        content: 'sent mid-turn',
        position: 'right',
        status: 'pending',
        hidden: false,
        created_at: Date.now(),
      });
    });

    expect(
      (result.current.messages.find((m) => m.msg_id === 'msg-midturn-1') as IMessageText | undefined)?.status
    ).toBe('pending');

    act(() => {
      emitStatusChanged?.({
        user_id: 'user-1',
        conversation_id: CONVERSATION_ID,
        msg_id: 'msg-midturn-1',
        status: 'finish',
      });
    });

    expect(
      (result.current.messages.find((m) => m.msg_id === 'msg-midturn-1') as IMessageText | undefined)?.status
    ).toBe('finish');
  });

  it('ignores message.statusChanged for a different conversation', async () => {
    const invoke = vi.mocked(ipcBridge.database.getConversationMessages.invoke);
    invoke.mockResolvedValue({
      items: [],
      oldest_cursor: null,
      newest_cursor: null,
      has_more_before: false,
      has_more_after: false,
    });

    let emitUserCreated: ((payload: any) => void) | undefined;
    let emitStatusChanged: ((payload: any) => void) | undefined;
    vi.mocked(ipcBridge.conversation.userCreated.on).mockImplementation((cb: any) => {
      emitUserCreated = cb;
      return () => {};
    });
    vi.mocked(ipcBridge.conversation.statusChanged.on).mockImplementation((cb: any) => {
      emitStatusChanged = cb;
      return () => {};
    });

    function useCacheAndListHarness() {
      useMessageLstCache(CONVERSATION_ID);
      return { messages: useMessageList() };
    }

    const { result } = renderHook(() => useCacheAndListHarness(), { wrapper: CacheWrapper });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      emitUserCreated?.({
        conversation_id: CONVERSATION_ID,
        msg_id: 'msg-midturn-2',
        content: 'sent mid-turn',
        position: 'right',
        status: 'pending',
        hidden: false,
        created_at: Date.now(),
      });
    });

    act(() => {
      emitStatusChanged?.({
        user_id: 'user-1',
        conversation_id: 'other-conversation',
        msg_id: 'msg-midturn-2',
        status: 'finish',
      });
    });

    expect(
      (result.current.messages.find((m) => m.msg_id === 'msg-midturn-2') as IMessageText | undefined)?.status
    ).toBe('pending');
  });

  it('reconciles a pending badge with the DB row when a turn completes for this conversation', async () => {
    const invoke = vi.mocked(ipcBridge.database.getConversationMessages.invoke);
    invoke.mockResolvedValueOnce({
      items: [],
      oldest_cursor: null,
      newest_cursor: null,
      has_more_before: false,
      has_more_after: false,
    });

    let emitUserCreated: ((payload: any) => void) | undefined;
    let emitTurnCompleted: ((payload: any) => void) | undefined;
    vi.mocked(ipcBridge.conversation.userCreated.on).mockImplementation((cb: any) => {
      emitUserCreated = cb;
      return () => {};
    });
    vi.mocked(ipcBridge.conversation.turnCompleted.on).mockImplementation((cb: any) => {
      emitTurnCompleted = cb;
      return () => {};
    });

    function useCacheAndListHarness() {
      useMessageLstCache(CONVERSATION_ID);
      return { messages: useMessageList() };
    }

    const { result } = renderHook(() => useCacheAndListHarness(), { wrapper: CacheWrapper });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      emitUserCreated?.({
        conversation_id: CONVERSATION_ID,
        msg_id: 'msg-midturn-3',
        content: 'sent mid-turn',
        position: 'right',
        status: 'pending',
        hidden: false,
        created_at: Date.now(),
      });
    });

    expect(
      (result.current.messages.find((m) => m.msg_id === 'msg-midturn-3') as IMessageText | undefined)?.status
    ).toBe('pending');

    // The reconcile reload returns the DB's authoritative 'finish' row — the
    // missed live statusChanged event never arrived, so this is the only
    // path that heals the badge.
    invoke.mockResolvedValueOnce({
      items: [
        {
          id: 'msg-midturn-3',
          msg_id: 'msg-midturn-3',
          conversation_id: CONVERSATION_ID,
          type: 'text',
          position: 'right',
          status: 'finish',
          hidden: false,
          created_at: Date.now(),
          content: { content: 'sent mid-turn' },
        },
      ],
      oldest_cursor: null,
      newest_cursor: null,
      has_more_before: false,
      has_more_after: false,
    });

    invoke.mockClear();

    act(() => {
      emitTurnCompleted?.({ session_id: CONVERSATION_ID, turn_id: 'turn-1' });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(invoke).toHaveBeenCalled();
    expect(
      (result.current.messages.find((m) => m.msg_id === 'msg-midturn-3') as IMessageText | undefined)?.status
    ).toBe('finish');
  });

  it('does not reload on turnCompleted when there is no pending right-position message', async () => {
    const invoke = vi.mocked(ipcBridge.database.getConversationMessages.invoke);
    invoke.mockResolvedValue({
      items: [],
      oldest_cursor: null,
      newest_cursor: null,
      has_more_before: false,
      has_more_after: false,
    });

    let emitTurnCompleted: ((payload: any) => void) | undefined;
    vi.mocked(ipcBridge.conversation.turnCompleted.on).mockImplementation((cb: any) => {
      emitTurnCompleted = cb;
      return () => {};
    });

    renderHook(() => useMessageLstCache(CONVERSATION_ID), { wrapper: CacheWrapper });

    await act(async () => {
      await Promise.resolve();
    });

    invoke.mockClear();

    act(() => {
      emitTurnCompleted?.({ session_id: CONVERSATION_ID, turn_id: 'turn-1' });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(invoke).not.toHaveBeenCalled();
  });

  it('ignores turnCompleted for a different conversation even with a pending row', async () => {
    const invoke = vi.mocked(ipcBridge.database.getConversationMessages.invoke);
    invoke.mockResolvedValue({
      items: [],
      oldest_cursor: null,
      newest_cursor: null,
      has_more_before: false,
      has_more_after: false,
    });

    let emitUserCreated: ((payload: any) => void) | undefined;
    let emitTurnCompleted: ((payload: any) => void) | undefined;
    vi.mocked(ipcBridge.conversation.userCreated.on).mockImplementation((cb: any) => {
      emitUserCreated = cb;
      return () => {};
    });
    vi.mocked(ipcBridge.conversation.turnCompleted.on).mockImplementation((cb: any) => {
      emitTurnCompleted = cb;
      return () => {};
    });

    function useCacheAndListHarness() {
      useMessageLstCache(CONVERSATION_ID);
      return { messages: useMessageList() };
    }

    renderHook(() => useCacheAndListHarness(), { wrapper: CacheWrapper });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      emitUserCreated?.({
        conversation_id: CONVERSATION_ID,
        msg_id: 'msg-midturn-4',
        content: 'sent mid-turn',
        position: 'right',
        status: 'pending',
        hidden: false,
        created_at: Date.now(),
      });
    });

    invoke.mockClear();

    act(() => {
      emitTurnCompleted?.({ session_id: 'other-conversation', turn_id: 'turn-1' });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(invoke).not.toHaveBeenCalled();
  });
});

const historyPage = (items: TMessage[], cursor = 'page', hasMoreBefore = false): MessageCursorPage<TMessage> => ({
  items,
  oldest_cursor: `${cursor}-oldest`,
  newest_cursor: `${cursor}-newest`,
  has_more_before: hasMoreBefore,
  has_more_after: false,
});

const deferredHistory = () => {
  let resolve!: (page: MessageCursorPage<TMessage>) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<MessageCursorPage<TMessage>>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

const useScopedHistoryHarness = (conversationId: string) => {
  useMessageLstCache(conversationId);
  usePendingConfirmationsRecovery(conversationId);
  return {
    messages: useMessageList(),
    loading: useMessageListLoading(),
    pagination: useMessagePaginationState(),
    previous: useLoadPreviousMessagePage(conversationId),
    anchor: useLoadAnchorMessageWindow(conversationId),
    live: useAddOrUpdateMessage(),
    scope: useHistoryRequestScope(conversationId),
    update: useUpdateMessageList(),
    setPagination: useUpdateMessagePaginationState(),
  };
};

const flushHistory = () => act(async () => {});

const latestListener = <T,>(mock: { mock: { calls: T[][] } }): T => mock.mock.calls.at(-1)![0];

describe('conversation history request scopes', () => {
  const get = vi.mocked(ipcBridge.database.getConversationMessages.invoke);
  beforeEach(() => {
    auth.id = 'test-user';
    get.mockReset();
    vi.mocked(ipcBridge.conversation.confirmation.list.invoke).mockReset().mockResolvedValue([]);
    vi.mocked(ipcBridge.conversation.confirmation.remove.on)
      .mockReset()
      .mockReturnValue(() => {});
    vi.mocked(ipcBridge.conversation.userCreated.on)
      .mockReset()
      .mockReturnValue(() => {});
    vi.mocked(ipcBridge.conversation.statusChanged.on)
      .mockReset()
      .mockReturnValue(() => {});
    vi.mocked(ipcBridge.conversation.turnCompleted.on)
      .mockReset()
      .mockReturnValue(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.each([false, true])(
    'ignores an earlier conversation initial result after switching (rejected: %s)',
    async (rejected) => {
      const old = deferredHistory();
      get.mockReturnValueOnce(old.promise);
      const { result, rerender } = renderHook(({ id }) => useScopedHistoryHarness(id), {
        initialProps: { id: CONVERSATION_ID },
        wrapper: CacheWrapper,
      });
      get.mockResolvedValueOnce(
        historyPage([{ ...createTextMessage('new', 'New conversation'), conversation_id: 'conversation-2' }], 'new')
      );
      rerender({ id: 'conversation-2' });
      await flushHistory();
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      await act(async () => {
        if (rejected) old.reject(new Error('old request failed'));
        else old.resolve(historyPage([createTextMessage('old', 'Old conversation')], 'old'));
      });
      expect(result.current.messages.map((message) => message.conversation_id)).toEqual(['conversation-2']);
      expect(result.current.pagination.oldestCursor).toBe('new-oldest');
      expect(result.current.loading).toBe(false);
      expect(error).not.toHaveBeenCalled();
    }
  );

  it('rejects an old account response even when the conversation id stays the same', async () => {
    const old = deferredHistory();
    get.mockReturnValueOnce(old.promise);
    const { result, rerender } = renderHook(() => useScopedHistoryHarness(CONVERSATION_ID), { wrapper: CacheWrapper });
    const priorScope = result.current.scope.current;
    auth.id = 'new-account';
    get.mockResolvedValueOnce(historyPage([createTextMessage('new-owner', 'New account history')], 'new-owner'));
    rerender();
    await flushHistory();
    await act(async () => old.resolve(historyPage([createTextMessage('private', 'Private old account')])));
    expect(result.current.scope.current).not.toBe(priorScope);
    expect(priorScope.active).toBe(false);
    expect(result.current.messages.map((message) => message.msg_id)).toEqual(['new-owner']);
  });

  it('hydrates again after remount and rejects the first StrictMode effect request', async () => {
    const old = deferredHistory();
    get
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(historyPage([createTextMessage('persisted', 'Persisted history')], 'persisted'));
    const view = renderHook(() => useScopedHistoryHarness(CONVERSATION_ID), {
      wrapper: CacheWrapper,
      reactStrictMode: true,
    });
    await flushHistory();
    expect(get).toHaveBeenCalledTimes(2);
    await act(async () => old.resolve(historyPage([])));
    expect(view.result.current.messages.map((message) => message.msg_id)).toEqual(['persisted']);
    view.unmount();
    get.mockResolvedValueOnce(historyPage([createTextMessage('reopened', 'History after reopening')], 'reopened'));
    const reopened = renderHook(() => useScopedHistoryHarness(CONVERSATION_ID), { wrapper: CacheWrapper });
    await flushHistory();
    expect(reopened.result.current.messages.map((message) => message.msg_id)).toEqual(['reopened']);
    expect(reopened.result.current.loading).toBe(false);
  });

  it('allows an anchor request to supersede a hanging initial latest page without retaining disjoint rows', async () => {
    const initial = deferredHistory();
    get.mockReturnValueOnce(initial.promise);
    const { result } = renderHook(() => useScopedHistoryHarness(CONVERSATION_ID), { wrapper: CacheWrapper });
    get.mockResolvedValueOnce({
      ...historyPage([createTextMessage('anchor', 'Anchored history')], 'anchor', true),
      has_more_after: true,
    });
    await act(() => result.current.anchor('anchor'));
    expect(result.current.loading).toBe(false);
    await act(async () => initial.resolve(historyPage([createTextMessage('latest', 'Old latest response')], 'latest')));
    expect(result.current.messages.map((message) => message.msg_id)).toEqual(['anchor']);
    expect(result.current.pagination.oldestCursor).toBe('anchor-oldest');
    expect(result.current.scope.current.window).toBe('anchor');
  });

  it.each([false, true])(
    'ignores an older previous-page result after an anchor jump (rejected: %s)',
    async (rejected) => {
      get.mockResolvedValueOnce(historyPage([createTextMessage('latest', 'Latest')], 'latest', true));
      const { result } = renderHook(() => useScopedHistoryHarness(CONVERSATION_ID), { wrapper: CacheWrapper });
      await flushHistory();
      const previous = deferredHistory();
      get.mockReturnValueOnce(previous.promise);
      let pending!: Promise<boolean>;
      act(() => {
        pending = result.current.previous();
      });
      get.mockResolvedValueOnce(historyPage([createTextMessage('anchor', 'Anchor')], 'anchor', true));
      await act(() => result.current.anchor('anchor'));
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      await act(async () => {
        if (rejected) previous.reject(new Error('previous page failed'));
        else previous.resolve(historyPage([createTextMessage('stale-before', 'Stale previous')], 'stale-before'));
        expect(await pending).toBe(false);
      });
      expect(result.current.messages.map((message) => message.msg_id)).toEqual(['anchor']);
      expect(result.current.pagination.oldestCursor).toBe('anchor-oldest');
      expect(result.current.pagination.isLoadingBefore).toBe(false);
      expect(error).not.toHaveBeenCalled();
    }
  );

  it.each(['initial', 'previous', 'anchor'] as const)(
    'honors the endpoint jump epoch that supersedes an older %s request',
    async (request) => {
      const older = deferredHistory();
      if (request === 'initial') get.mockReturnValueOnce(older.promise);
      else get.mockResolvedValueOnce(historyPage([createTextMessage('old-latest', 'Old latest')], 'latest', true));
      const { result } = renderHook(() => useScopedHistoryHarness(CONVERSATION_ID), { wrapper: CacheWrapper });
      await flushHistory();
      let pending: Promise<boolean> | undefined;
      if (request !== 'initial') {
        get.mockReturnValueOnce(older.promise);
        act(() => {
          pending = request === 'previous' ? result.current.previous() : result.current.anchor('old-anchor');
        });
      }
      // Item 18 owns the endpoint fetch/UI; this is its shared scope contract.
      act(() => {
        ++result.current.scope.current.epoch;
        result.current.scope.current.window = 'first';
        result.current.update([createTextMessage('first', 'First bounded page')]);
        result.current.setPagination({
          oldestCursor: 'first-oldest',
          newestCursor: 'first-newest',
          hasMoreBefore: false,
          hasMoreAfter: true,
          isLoadingBefore: false,
          isLoadingAnchor: false,
        });
      });
      await act(async () => {
        older.resolve(historyPage([createTextMessage('old-response', 'Old response')], 'stale'));
        await pending;
      });
      expect(result.current.messages.map((message) => message.msg_id)).toEqual(['first']);
      expect(result.current.pagination.oldestCursor).toBe('first-oldest');
      expect(result.current.scope.current.window).toBe('first');
    }
  );

  it('admits overlapping live updates without inserting a latest tail or reloading while browsing earlier history', async () => {
    get.mockResolvedValueOnce(historyPage([createTextMessage('latest', 'Latest')], 'latest'));
    const { result } = renderHook(() => useScopedHistoryHarness(CONVERSATION_ID), { wrapper: CacheWrapper });
    await flushHistory();
    const existing = {
      ...createTextMessage('earlier', 'Before'),
      position: 'right' as const,
      status: 'pending' as const,
    };
    get.mockResolvedValueOnce({ ...historyPage([existing], 'earlier'), has_more_after: true });
    await act(() => result.current.anchor('earlier'));
    const created = latestListener(vi.mocked(ipcBridge.conversation.userCreated.on));
    const completed = latestListener(vi.mocked(ipcBridge.conversation.turnCompleted.on));
    const requests = get.mock.calls.length;
    act(() => {
      created({
        conversation_id: CONVERSATION_ID,
        msg_id: 'new-tail',
        client_msg_id: 'client',
        content: 'New tail',
        position: 'right',
        status: 'pending',
        hidden: false,
        created_at: 1,
      });
      completed({ session_id: CONVERSATION_ID, turn_id: 'turn', state: 'completed' });
      result.current.live(createTextMessage('earlier', ' overlapping update'));
      result.current.live(createTextMessage('tail', 'Disjoint tail'));
      result.current.live({ ...createTextMessage('foreign', 'Foreign'), conversation_id: 'foreign-conversation' });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(get).toHaveBeenCalledTimes(requests);
    expect(result.current.messages.map((message) => message.msg_id)).toEqual(['earlier']);
    expect((result.current.messages[0] as IMessageText).content.content).toBe('Before overlapping update');
    act(() => {
      ++result.current.scope.current.epoch;
      result.current.scope.current.window = 'latest';
      result.current.live(createTextMessage('resumed', 'Live after navigation'));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(result.current.messages.some((message) => message.msg_id === 'resumed')).toBe(true);
  });

  it('rejects a queued old-conversation frame after switching before its flush', async () => {
    get.mockResolvedValueOnce(historyPage([]));
    const { result, rerender } = renderHook(({ id }) => useScopedHistoryHarness(id), {
      initialProps: { id: CONVERSATION_ID },
      wrapper: CacheWrapper,
    });
    await flushHistory();
    act(() => result.current.live(createTextMessage('queued', 'Old queued frame')));
    get.mockResolvedValueOnce(historyPage([{ ...createTextMessage('new', 'New'), conversation_id: 'conversation-2' }]));
    rerender({ id: 'conversation-2' });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(result.current.messages.map((message) => message.msg_id)).toEqual(['new']);
  });

  it('keeps the known newest boundary when adding a previous page', async () => {
    get.mockResolvedValueOnce(historyPage([createTextMessage('latest', 'Latest')], 'latest', true));
    const { result } = renderHook(() => useScopedHistoryHarness(CONVERSATION_ID), { wrapper: CacheWrapper });
    await flushHistory();
    get.mockResolvedValueOnce({ ...historyPage([createTextMessage('older', 'Older')], 'older'), has_more_after: true });
    await act(() => result.current.previous());
    expect(result.current.messages.map((message) => message.msg_id)).toEqual(['older', 'latest']);
    expect(result.current.pagination.newestCursor).toBe('latest-newest');
    expect(result.current.pagination.hasMoreAfter).toBe(false);
  });

  it.each(['tool_call', 'acp_tool_call', 'acp_terminal_output', 'permission'] as const)(
    'updates only the same logical %s in an earlier window when a turn has several calls',
    async (kind) => {
      const message = (callId: string, text: string): TMessage => {
        const base = {
          id: `${kind}-${callId}-${text}`,
          msg_id: 'shared-turn',
          conversation_id: CONVERSATION_ID,
          position: 'left' as const,
        };
        if (kind === 'tool_call')
          return {
            ...base,
            type: kind,
            content: { call_id: callId, name: 'Read', args: {}, status: 'completed', output: text },
          };
        if (kind === 'acp_tool_call')
          return {
            ...createToolCallMessage(callId),
            ...base,
            content: {
              session_id: CONVERSATION_ID,
              update: {
                sessionUpdate: 'tool_call',
                tool_call_id: callId,
                title: text,
                status: 'completed',
                kind: 'read',
              },
            },
          };
        if (kind === 'acp_terminal_output')
          return {
            ...base,
            type: kind,
            content: { terminal_id: callId, command: 'echo', output: text, truncated: false },
          };
        return {
          ...base,
          type: 'permission',
          content: {
            id: callId,
            call_id: callId,
            title: text,
            description: 'Review',
            command_type: 'edit',
            options: [{ label: 'Allow', value: 'allow' }],
          },
        };
      };
      get.mockResolvedValueOnce(historyPage([]));
      const { result } = renderHook(() => useScopedHistoryHarness(CONVERSATION_ID), { wrapper: CacheWrapper });
      await flushHistory();
      get.mockResolvedValueOnce({ ...historyPage([message('existing', 'Before')], 'anchor'), has_more_after: true });
      await act(() => result.current.anchor('anchor'));
      act(() => {
        result.current.live(message('new-call', 'Disjoint new call'));
        result.current.live(message('existing', 'Updated existing call'), true);
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(result.current.messages).toHaveLength(1);
      expect(JSON.stringify(result.current.messages[0].content)).toContain('Updated existing call');
      expect(JSON.stringify(result.current.messages)).not.toContain('Disjoint new call');
    }
  );

  it.each(['previous', 'forward'] as const)(
    'preserves loaded %s boundaries and order during pending-delivery reconciliation',
    async (loadedVia) => {
      const pending = {
        ...createTextMessage('pending-user', 'Delivered input'),
        position: 'right' as const,
        status: 'pending' as const,
      };
      get.mockResolvedValueOnce(historyPage([pending], 'latest', true));
      const { result } = renderHook(() => useScopedHistoryHarness(CONVERSATION_ID), { wrapper: CacheWrapper });
      await flushHistory();
      if (loadedVia === 'previous') {
        get.mockResolvedValueOnce({
          ...historyPage([createTextMessage('older', 'Older loaded history')], 'older', true),
          has_more_after: true,
        });
        await act(() => result.current.previous());
      } else {
        // The item 18 next-page hook appends rows and marks a terminal page latest.
        act(() => {
          ++result.current.scope.current.epoch;
          result.current.scope.current.window = 'latest';
          result.current.update([createTextMessage('older', 'Older loaded history'), pending]);
          result.current.setPagination({
            oldestCursor: 'older-oldest',
            newestCursor: 'latest-newest',
            hasMoreBefore: true,
            hasMoreAfter: false,
            isLoadingBefore: false,
            isLoadingAnchor: false,
          });
        });
      }
      get.mockResolvedValueOnce(
        historyPage(
          [{ ...pending, status: 'finish' }, createTextMessage('new-agent', 'New response')],
          'reconciled',
          true
        )
      );
      act(() =>
        latestListener(vi.mocked(ipcBridge.conversation.turnCompleted.on))({
          session_id: CONVERSATION_ID,
          turn_id: 'completed',
          state: 'completed',
        })
      );
      await flushHistory();
      expect(result.current.messages.map((message) => message.msg_id)).toEqual(['older', 'pending-user', 'new-agent']);
      expect(result.current.messages[1].status).toBe('finish');
      expect(result.current.pagination.oldestCursor).toBe('older-oldest');
      expect(result.current.pagination.hasMoreBefore).toBe(true);
      expect(result.current.pagination.newestCursor).toBe('reconciled-newest');
    }
  );

  it('does not let a background pending-badge reload supersede an explicit latest jump', async () => {
    const pending = {
      ...createTextMessage('pending', 'Pending input'),
      position: 'right' as const,
      status: 'pending' as const,
    };
    get.mockResolvedValueOnce(historyPage([pending]));
    const { result } = renderHook(() => useScopedHistoryHarness(CONVERSATION_ID), { wrapper: CacheWrapper });
    await flushHistory();
    const epoch = result.current.scope.current.epoch + 1;
    act(() => {
      result.current.scope.current.epoch = epoch;
      result.current.scope.current.navigationEpoch = epoch;
    });
    act(() =>
      latestListener(vi.mocked(ipcBridge.conversation.turnCompleted.on))({
        session_id: CONVERSATION_ID,
        turn_id: 'turn',
        state: 'completed',
      })
    );
    await flushHistory();
    expect(get).toHaveBeenCalledTimes(1);
    expect(result.current.scope.current.epoch).toBe(epoch);
    expect(result.current.scope.current.navigationEpoch).toBe(epoch);
  });

  it('replaces a disjoint latest reconciliation with its canonical bounded cursor window', async () => {
    const pending = {
      ...createTextMessage('old-pending', 'Old input'),
      position: 'right' as const,
      status: 'pending' as const,
    };
    get.mockResolvedValueOnce(historyPage([pending], 'old', true));
    const { result } = renderHook(() => useScopedHistoryHarness(CONVERSATION_ID), { wrapper: CacheWrapper });
    await flushHistory();
    get.mockResolvedValueOnce(historyPage([createTextMessage('new-window', 'New latest window')], 'new-window', true));
    act(() =>
      latestListener(vi.mocked(ipcBridge.conversation.turnCompleted.on))({
        session_id: CONVERSATION_ID,
        turn_id: 'turn',
        state: 'completed',
      })
    );
    await flushHistory();
    expect(result.current.messages.map((message) => message.msg_id)).toEqual(['new-window']);
    expect(result.current.pagination.oldestCursor).toBe('new-window-oldest');
  });

  it.each(['conversation', 'account'] as const)(
    'does not recover a pending permission from an older %s scope',
    async (changed) => {
      const confirmation = {
        id: 'old-permission',
        call_id: 'old-call',
        title: 'Old permission',
        description: 'Old request',
        command_type: 'edit' as const,
        options: [{ label: 'Allow', value: 'allow' }],
      };
      let finish!: (value: (typeof confirmation)[]) => void;
      vi.mocked(ipcBridge.conversation.confirmation.list.invoke).mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        })
      );
      get.mockResolvedValue(historyPage([]));
      const { result, rerender } = renderHook(({ id }) => useScopedHistoryHarness(id), {
        initialProps: { id: CONVERSATION_ID },
        wrapper: CacheWrapper,
      });
      await flushHistory();
      if (changed === 'account') auth.id = 'second-account';
      rerender({ id: changed === 'conversation' ? 'conversation-2' : CONVERSATION_ID });
      await flushHistory();
      await act(async () => finish([confirmation]));
      expect(result.current.messages).toEqual([]);
    }
  );

  it('does not append newly recovered permissions to an earlier anchor window', async () => {
    const confirmation = {
      id: 'latest-permission',
      call_id: 'latest-call',
      title: 'Latest permission',
      description: 'Latest request',
      command_type: 'edit' as const,
      options: [{ label: 'Allow', value: 'allow' }],
    };
    let finish!: (value: (typeof confirmation)[]) => void;
    vi.mocked(ipcBridge.conversation.confirmation.list.invoke).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    get.mockResolvedValueOnce(historyPage([]));
    const { result } = renderHook(() => useScopedHistoryHarness(CONVERSATION_ID), { wrapper: CacheWrapper });
    await flushHistory();
    get.mockResolvedValueOnce({
      ...historyPage([createTextMessage('anchor', 'Anchor history')], 'anchor'),
      has_more_after: true,
    });
    await act(() => result.current.anchor('anchor'));
    await act(async () => finish([confirmation]));
    expect(result.current.messages.map((message) => message.msg_id)).toEqual(['anchor']);
  });

  it.each([false, true])('ignores an old anchor after changing conversations (rejected: %s)', async (rejected) => {
    get.mockResolvedValueOnce(historyPage([createTextMessage('old-latest', 'Old latest')], 'old', true));
    const { result, rerender } = renderHook(({ id }) => useScopedHistoryHarness(id), {
      initialProps: { id: CONVERSATION_ID },
      wrapper: CacheWrapper,
    });
    await flushHistory();
    const anchor = deferredHistory();
    get.mockReturnValueOnce(anchor.promise);
    let pending!: Promise<boolean>;
    act(() => {
      pending = result.current.anchor('old-anchor');
    });
    get.mockResolvedValueOnce(
      historyPage([{ ...createTextMessage('new', 'New conversation'), conversation_id: 'conversation-2' }], 'new')
    );
    rerender({ id: 'conversation-2' });
    await flushHistory();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => {
      if (rejected) anchor.reject(new Error('old anchor failed'));
      else anchor.resolve(historyPage([]));
      expect(await pending).toBe(false);
    });
    expect(result.current.messages.map((message) => message.msg_id)).toEqual(['new']);
    expect(result.current.pagination.oldestCursor).toBe('new-oldest');
    expect(result.current.pagination.isLoadingAnchor).toBe(false);
    expect(result.current.scope.current.window).toBe('latest');
    expect(error).not.toHaveBeenCalled();
  });

  it('rejects an old live callback after switching accounts with the same conversation id', async () => {
    get.mockResolvedValueOnce(historyPage([]));
    const { result, rerender } = renderHook(() => useScopedHistoryHarness(CONVERSATION_ID), { wrapper: CacheWrapper });
    await flushHistory();
    const oldLive = result.current.live;
    const oldUserCreated = latestListener(vi.mocked(ipcBridge.conversation.userCreated.on));
    auth.id = 'new-account';
    get.mockResolvedValueOnce(historyPage([]));
    rerender();
    await flushHistory();
    act(() => {
      oldLive(createTextMessage('private-frame', 'Old account private frame'));
      oldUserCreated({
        conversation_id: CONVERSATION_ID,
        msg_id: 'private-user',
        client_msg_id: 'client',
        content: 'Old account user input',
        position: 'right',
        status: 'pending',
        hidden: false,
        created_at: 1,
      });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(result.current.messages).toEqual([]);
  });

  it('accepts canonical pagination if a pending delivery reload supersedes initial hydration', async () => {
    const initial = deferredHistory();
    get.mockReturnValueOnce(initial.promise);
    const { result } = renderHook(() => useScopedHistoryHarness(CONVERSATION_ID), { wrapper: CacheWrapper });
    act(() =>
      latestListener(vi.mocked(ipcBridge.conversation.userCreated.on))({
        conversation_id: CONVERSATION_ID,
        msg_id: 'pending-during-load',
        client_msg_id: 'client',
        content: 'Pending while loading',
        position: 'right',
        status: 'pending',
        hidden: false,
        created_at: 1,
      })
    );
    const finished = {
      ...createTextMessage('pending-during-load', 'Pending while loading'),
      position: 'right' as const,
      status: 'finish' as const,
    };
    get.mockResolvedValueOnce(historyPage([finished], 'canonical', true));
    act(() =>
      latestListener(vi.mocked(ipcBridge.conversation.turnCompleted.on))({
        session_id: CONVERSATION_ID,
        turn_id: 'turn',
        state: 'completed',
      })
    );
    await flushHistory();
    await act(async () => initial.resolve(historyPage([])));
    expect(result.current.messages[0].status).toBe('finish');
    expect(result.current.pagination.oldestCursor).toBe('canonical-oldest');
    expect(result.current.pagination.hasMoreBefore).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it('does not let a reader with a retired context rebind the authoritative cache conversation', async () => {
    get.mockResolvedValueOnce(historyPage([]));
    const { result, rerender } = renderHook(
      ({ id, readerId }) => {
        const history = useScopedHistoryHarness(id);
        const readerScope = useHistoryRequestScope(readerId);
        return { history, readerScope };
      },
      { initialProps: { id: CONVERSATION_ID, readerId: CONVERSATION_ID }, wrapper: CacheWrapper }
    );
    await flushHistory();
    get.mockResolvedValueOnce(
      historyPage([{ ...createTextMessage('new', 'New cache conversation'), conversation_id: 'conversation-2' }], 'new')
    );
    rerender({ id: 'conversation-2', readerId: CONVERSATION_ID });
    await flushHistory();
    expect(result.current.readerScope).toBe(result.current.history.scope);
    expect(result.current.history.scope.current.conversationId).toBe('conversation-2');
    expect(result.current.history.messages.map((message) => message.msg_id)).toEqual(['new']);
  });
});

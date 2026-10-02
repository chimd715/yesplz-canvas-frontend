/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import { requestConversationSendBoxPrefill } from '@/renderer/hooks/chat/useSendBoxDraft';
import { refreshConversationCache } from '@/renderer/pages/conversation/utils/conversationCache';
import { isLegacyReadOnlyConversationType } from '@/renderer/pages/conversation/utils/conversationRuntime';
import { emitter } from '@/renderer/utils/emitter';
import { blockMobileInputFocus, blurActiveElement } from '@/renderer/utils/ui/focus';
import { Message, Modal } from '@arco-design/web-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

import { isConversationPinned } from '../utils/groupingHelpers';
import {
  isConversationListScopeCurrent,
  reconcileSidebarArchive,
  removeDeletedConversation,
  useConversationListScope,
} from './useConversationListSync';

type UseConversationActionsParams = {
  batchMode: boolean;
  onSessionClick?: () => void;
  onBatchModeChange?: (value: boolean) => void;
  selectedConversationIds: Set<string>;
  setSelectedConversationIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  toggleSelectedConversation: (conversation: TChatConversation) => void;
  markAsRead: (conversation_id: string) => void;
  markManualUnread: (conversation_id: string) => void;
  clearManualUnread: (conversation_id: string) => void;
  isManualUnread: (conversation_id: string) => boolean;
};

export const useConversationActions = ({
  batchMode,
  onSessionClick,
  onBatchModeChange,
  selectedConversationIds,
  setSelectedConversationIds,
  toggleSelectedConversation,
  markAsRead,
  markManualUnread,
  clearManualUnread,
  isManualUnread,
}: UseConversationActionsParams) => {
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [renameModalName, setRenameModalName] = useState<string>('');
  const [renameModalId, setRenameModalId] = useState<string | null>(null);
  const [renameLoading, setRenameLoading] = useState(false);
  const [dropdownVisibleId, setDropdownVisibleId] = useState<string | null>(null);
  const { id } = useParams();
  const scope = useConversationListScope();
  const activeIdRef = useRef(id);
  activeIdRef.current = id;
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Close dropdown when entering batch mode
  useEffect(() => {
    if (batchMode) {
      setDropdownVisibleId(null);
    }
  }, [batchMode]);

  const handleConversationClick = useCallback(
    (conversation: TChatConversation) => {
      setDropdownVisibleId(null);
      if (batchMode) {
        toggleSelectedConversation(conversation);
        return;
      }
      blockMobileInputFocus();
      blurActiveElement();

      markAsRead(conversation.id);

      void navigate(`/conversation/${conversation.id}`);
      if (onSessionClick) {
        onSessionClick();
      }
    },
    [batchMode, toggleSelectedConversation, markAsRead, navigate, onSessionClick]
  );

  const removeConversation = useCallback(
    async (conversation_id: string) => {
      if (!isConversationListScopeCurrent(scope)) return false;
      const success = await ipcBridge.conversation.remove.invoke({ id: conversation_id });
      if (success === false || !isConversationListScopeCurrent(scope)) {
        return false;
      }

      removeDeletedConversation(conversation_id);
      emitter.emit('conversation.deleted', conversation_id);
      if (activeIdRef.current === conversation_id) {
        void navigate('/', { replace: true });
      }
      return true;
    },
    [navigate, scope]
  );

  const handleDelete = useCallback(
    (conversation: TChatConversation) => {
      setDropdownVisibleId(null);
      Modal.confirm({
        title: t('conversation.history.deleteTitle'),
        content: t('conversation.history.deleteConfirm'),
        okText: t('conversation.history.deleteTitle'),
        cancelText: t('common.cancel'),
        okButtonProps: { status: 'danger' },
        onOk: async () => {
          if (!isConversationListScopeCurrent(scope)) return;
          try {
            const removed = await removeConversation(conversation.id);
            if (!isConversationListScopeCurrent(scope)) return;
            if (!removed) {
              Message.error(t('conversation.history.deleteFailed'));
              return;
            }
            setSelectedConversationIds((previous) => {
              const next = new Set(previous);
              next.delete(conversation.id);
              return next;
            });
            Message.success(t('conversation.history.deleteSuccess'));
          } catch {
            if (!isConversationListScopeCurrent(scope)) return;
            Message.error(t('conversation.history.deleteFailed'));
          }
        },
        style: { borderRadius: '12px' },
        alignCenter: true,
        getPopupContainer: () => document.body,
      });
    },
    [removeConversation, scope, setSelectedConversationIds, t]
  );

  const archiveConversation = useCallback(
    async (conversation_id: string, conversation?: TChatConversation) => {
      if (!isConversationListScopeCurrent(scope)) return false;
      await ipcBridge.sidebar.archive.invoke({ item_type: 'conversation', item_id: conversation_id });
      if (!isConversationListScopeCurrent(scope)) return false;
      reconcileSidebarArchive({
        scope,
        item_type: 'conversation',
        item_id: conversation_id,
        archived: true,
        conversation,
      });
      if (activeIdRef.current === conversation_id) void navigate('/', { replace: true });
      return true;
    },
    [navigate, scope]
  );

  const handleBatchArchive = useCallback(() => {
    if (selectedConversationIds.size === 0) {
      Message.warning(t('conversation.history.batchNoSelection'));
      return;
    }

    Modal.confirm({
      title: t('conversation.history.batchArchive'),
      content: t('conversation.history.batchArchiveConfirm', { count: selectedConversationIds.size }),
      okText: t('conversation.history.batchArchive'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        if (!isConversationListScopeCurrent(scope)) return;
        const selectedIds = Array.from(selectedConversationIds);
        try {
          const results = await Promise.allSettled(selectedIds.map((item_id) => archiveConversation(item_id)));
          if (!isConversationListScopeCurrent(scope)) return;
          const successCount = results.filter((r) => r.status === 'fulfilled' && r.value).length;
          const failedIds = selectedIds.filter((_id, index) => results[index].status === 'rejected');
          setSelectedConversationIds(new Set(failedIds));
          onBatchModeChange?.(failedIds.length > 0);
          emitter.emit('chat.history.refresh');
          if (successCount > 0) {
            Message.success(t('conversation.history.batchArchiveSuccess', { count: successCount }));
          } else {
            Message.error(t('conversation.history.archiveFailed'));
          }
        } catch (error) {
          if (!isConversationListScopeCurrent(scope)) return;
          console.error('Failed to batch archive conversations:', error);
          Message.error(t('conversation.history.archiveFailed'));
        }
      },
      style: { borderRadius: '12px' },
      alignCenter: true,
      getPopupContainer: () => document.body,
    });
  }, [archiveConversation, onBatchModeChange, scope, selectedConversationIds, t, setSelectedConversationIds]);

  const handleEditStart = useCallback((conversation: TChatConversation) => {
    setRenameModalId(conversation.id);
    setRenameModalName(conversation.name);
    setRenameModalVisible(true);
  }, []);

  const handleRenameConfirm = useCallback(async () => {
    if (!renameModalId || !renameModalName.trim()) return;

    setRenameLoading(true);
    try {
      const success = await ipcBridge.conversation.update.invoke({
        id: renameModalId,
        updates: { name: renameModalName.trim() },
      });

      if (success) {
        await refreshConversationCache(renameModalId);
        emitter.emit('chat.history.refresh');
        setRenameModalVisible(false);
        setRenameModalId(null);
        setRenameModalName('');
        Message.success(t('conversation.history.renameSuccess'));
      } else {
        Message.error(t('conversation.history.renameFailed'));
      }
    } catch (error) {
      console.error('Failed to update conversation name:', error);
      Message.error(t('conversation.history.renameFailed'));
    } finally {
      setRenameLoading(false);
    }
  }, [renameModalId, renameModalName, t]);

  const handleRenameCancel = useCallback(() => {
    setRenameModalVisible(false);
    setRenameModalId(null);
    setRenameModalName('');
  }, []);

  const handleTogglePin = useCallback(
    async (conversation: TChatConversation) => {
      const pinned = isConversationPinned(conversation);

      try {
        const success = await ipcBridge.conversation.update.invoke({
          id: conversation.id,
          updates: {
            extra: {
              pinned: !pinned,
              pinned_at: pinned ? undefined : Date.now(),
            } as Partial<TChatConversation['extra']>,
          } as Partial<TChatConversation>,
          merge_extra: true,
        });

        if (success) {
          emitter.emit('chat.history.refresh');
        } else {
          Message.error(t('conversation.history.pinFailed'));
        }
      } catch (error) {
        console.error('Failed to toggle pin conversation:', error);
        Message.error(t('conversation.history.pinFailed'));
      }
    },
    [t]
  );

  const handleMenuVisibleChange = useCallback((conversation_id: string, visible: boolean) => {
    setDropdownVisibleId(visible ? conversation_id : null);
  }, []);

  const handleToggleManualUnread = useCallback(
    (conversation: TChatConversation) => {
      if (isManualUnread(conversation.id)) {
        clearManualUnread(conversation.id);
      } else {
        markManualUnread(conversation.id);
      }
    },
    [clearManualUnread, isManualUnread, markManualUnread]
  );

  const handleOpenMenu = useCallback((conversation: TChatConversation) => {
    setDropdownVisibleId(conversation.id);
  }, []);

  const handleCreateCronTask = useCallback(
    (conversation: TChatConversation) => {
      const prefillPrompt = t('cron.status.defaultPrompt');
      setDropdownVisibleId(null);

      if (isLegacyReadOnlyConversationType(conversation.type)) {
        void navigate('/guid', {
          state: {
            prefillPrompt,
            preservePrefillDraft: true,
            focusPrefill: true,
          },
        });
      } else {
        requestConversationSendBoxPrefill(conversation.id, prefillPrompt);
        if (id !== conversation.id) {
          void navigate(`/conversation/${conversation.id}`);
        }
      }

      onSessionClick?.();
    },
    [id, navigate, onSessionClick, t]
  );

  /**
   * Archive-project state — rendered via AionModal in the GroupedHistory component.
   * The left panel groups conversations by workspace folder (not by a bound
   * project record), so there is no project id to hand the `archiveProject`
   * endpoint. Archiving the group therefore archives each conversation in it —
   * the same soft move as the per-row and batch archive actions.
   */
  const [archiveProjectTarget, setArchiveProjectTarget] = useState<{
    name: string;
    conversations: TChatConversation[];
  } | null>(null);
  const [archiveProjectLoading, setArchiveProjectLoading] = useState(false);

  const handleArchiveProject = useCallback((projectName: string, conversations: TChatConversation[]) => {
    if (conversations.length === 0) return;
    setArchiveProjectTarget({ name: projectName, conversations });
  }, []);

  const handleArchiveProjectCancel = useCallback(() => {
    if (archiveProjectLoading) return;
    setArchiveProjectTarget(null);
  }, [archiveProjectLoading]);

  const handleArchiveProjectConfirm = useCallback(async () => {
    if (!archiveProjectTarget || !isConversationListScopeCurrent(scope)) return;
    setArchiveProjectLoading(true);
    try {
      const results = await Promise.allSettled(
        archiveProjectTarget.conversations.map((c) => archiveConversation(c.id, c))
      );
      if (!isConversationListScopeCurrent(scope)) return;
      const successCount = results.filter((r) => r.status === 'fulfilled' && r.value).length;
      emitter.emit('chat.history.refresh');
      if (successCount > 0) {
        Message.success(t('conversation.history.batchArchiveSuccess', { count: successCount }));
      } else {
        Message.error(t('conversation.history.archiveFailed'));
      }
      setArchiveProjectTarget(null);
    } catch (error) {
      if (!isConversationListScopeCurrent(scope)) return;
      console.error('Failed to archive project:', error);
      Message.error(t('conversation.history.archiveFailed'));
    } finally {
      setArchiveProjectLoading(false);
    }
  }, [archiveConversation, archiveProjectTarget, scope, t]);

  const handleArchive = useCallback(
    async (conversation: TChatConversation) => {
      setDropdownVisibleId(null);
      try {
        if (!(await archiveConversation(conversation.id, conversation))) return;
        emitter.emit('chat.history.refresh');
        Message.success(t('conversation.history.archiveSuccess'));
      } catch (error) {
        if (!isConversationListScopeCurrent(scope)) return;
        console.error('Failed to archive conversation:', error);
        Message.error(t('conversation.history.archiveFailed'));
      }
    },
    [archiveConversation, scope, t]
  );

  return {
    renameModalVisible,
    renameModalName,
    setRenameModalName,
    renameLoading,
    dropdownVisibleId,
    handleConversationClick,
    handleBatchArchive,
    handleArchive,
    handleDelete,
    handleEditStart,
    handleRenameConfirm,
    handleRenameCancel,
    handleTogglePin,
    handleMenuVisibleChange,
    handleOpenMenu,
    handleToggleManualUnread,
    handleCreateCronTask,
    handleArchiveProject,
    archiveProjectTarget,
    archiveProjectLoading,
    handleArchiveProjectCancel,
    handleArchiveProjectConfirm,
  };
};

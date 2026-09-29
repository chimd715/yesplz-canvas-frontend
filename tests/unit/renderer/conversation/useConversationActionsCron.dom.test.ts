/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { navigateMock, requestPrefillMock, routeState } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  requestPrefillMock: vi.fn(),
  routeState: { id: 'current-conversation' as string | undefined },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'cron.status.defaultPrompt' ? 'Create with /cron in AionUi' : key),
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: () => ({ id: routeState.id }),
  };
});

vi.mock('@arco-design/web-react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@arco-design/web-react')>()),
  Message: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      remove: { invoke: vi.fn() },
      update: { invoke: vi.fn() },
    },
    sidebar: { archive: { invoke: vi.fn() } },
  },
}));

vi.mock('@/renderer/hooks/chat/useSendBoxDraft', () => ({
  requestConversationSendBoxPrefill: requestPrefillMock,
}));

vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  refreshConversationCache: vi.fn(),
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: { emit: vi.fn() },
}));

vi.mock('@/renderer/utils/ui/focus', () => ({
  blockMobileInputFocus: vi.fn(),
  blurActiveElement: vi.fn(),
}));

import { useConversationActions } from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversationActions';
import { ipcBridge } from '@/common';

const makeConversation = (id: string, type: TChatConversation['type']): TChatConversation =>
  ({
    id,
    type,
    name: id,
    created_at: 1,
    modified_at: 1,
    extra: type === 'acp' ? { backend: 'claude' } : {},
    model: {},
  }) as TChatConversation;

const renderActions = (onSessionClick?: () => void) =>
  renderHook(() =>
    useConversationActions({
      batchMode: false,
      onSessionClick,
      selectedConversationIds: new Set(),
      setSelectedConversationIds: vi.fn(),
      toggleSelectedConversation: vi.fn(),
      markAsRead: vi.fn(),
      markManualUnread: vi.fn(),
      clearManualUnread: vi.fn(),
      isManualUnread: () => false,
    })
  );

describe('create scheduled task conversation action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeState.id = 'current-conversation';
  });

  it('prefills the current editable conversation without navigating', () => {
    const { result } = renderActions();

    act(() => result.current.handleCreateCronTask(makeConversation('current-conversation', 'acp')));

    expect(requestPrefillMock).toHaveBeenCalledWith('current-conversation', 'Create with /cron in AionUi');
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('queues the target-scoped prefill before navigating to a background conversation', () => {
    const onSessionClick = vi.fn();
    const { result } = renderActions(onSessionClick);

    act(() => result.current.handleCreateCronTask(makeConversation('background-conversation', 'aionrs')));

    expect(requestPrefillMock).toHaveBeenCalledWith('background-conversation', 'Create with /cron in AionUi');
    expect(navigateMock).toHaveBeenCalledWith('/conversation/background-conversation');
    expect(requestPrefillMock.mock.invocationCallOrder[0]).toBeLessThan(navigateMock.mock.invocationCallOrder[0]);
    expect(onSessionClick).toHaveBeenCalledOnce();
  });

  it('opens a central sidebar row through its logical conversation URL', () => {
    const { result } = renderActions();
    const conversation = { ...makeConversation('active-core', 'aionrs'), logical_conversation_id: 'logical-chat' };

    act(() => result.current.handleConversationClick(conversation));

    expect(navigateMock).toHaveBeenCalledWith('/conversation/logical-chat');
  });

  it('keeps the cron draft scoped to Core while retaining the current logical URL', () => {
    routeState.id = 'logical-chat';
    const { result } = renderActions();
    const conversation = { ...makeConversation('active-core', 'aionrs'), logical_conversation_id: 'logical-chat' };

    act(() => result.current.handleCreateCronTask(conversation));

    expect(requestPrefillMock).toHaveBeenCalledWith('active-core', 'Create with /cron in AionUi');
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('renames the active Core conversation for a logical sidebar row', async () => {
    const { result } = renderActions();
    const conversation = { ...makeConversation('active-core', 'aionrs'), logical_conversation_id: 'logical-chat' };
    vi.mocked(ipcBridge.conversation.update.invoke).mockResolvedValue(true);

    act(() => result.current.handleEditStart(conversation));
    act(() => result.current.setRenameModalName('Renamed'));
    await act(() => result.current.handleRenameConfirm());

    expect(ipcBridge.conversation.update.invoke).toHaveBeenCalledWith({
      id: 'active-core',
      updates: { name: 'Renamed' },
    });
  });

  it('archives the active Core conversation for a logical sidebar row', async () => {
    const { result } = renderActions();
    const conversation = { ...makeConversation('active-core', 'aionrs'), logical_conversation_id: 'logical-chat' };

    await act(() => result.current.handleArchive(conversation));

    expect(ipcBridge.sidebar.archive.invoke).toHaveBeenCalledWith({
      item_type: 'conversation',
      item_id: 'active-core',
    });
  });

  it('pins the active Core conversation for a logical sidebar row', async () => {
    const { result } = renderActions();
    const conversation = { ...makeConversation('active-core', 'aionrs'), logical_conversation_id: 'logical-chat' };

    await act(() => result.current.handleTogglePin(conversation));

    expect(ipcBridge.conversation.update.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'active-core', merge_extra: true })
    );
  });

  it.each(['openclaw-gateway', 'nanobot', 'remote', 'gemini', 'codex'])(
    'routes the read-only %s conversation to a draft-preserving Guid prefill',
    (type) => {
      const { result } = renderActions();

      act(() => result.current.handleCreateCronTask(makeConversation(`readonly-${type}`, type)));

      expect(requestPrefillMock).not.toHaveBeenCalled();
      expect(navigateMock).toHaveBeenCalledWith('/guid', {
        state: {
          prefillPrompt: 'Create with /cron in AionUi',
          preservePrefillDraft: true,
          focusPrefill: true,
        },
      });
    }
  );
});

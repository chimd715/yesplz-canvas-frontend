/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import type { TChatConversation } from '@/common/config/storage';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  archive: vi.fn(),
  archiveReconcile: vi.fn(),
  selection: vi.fn(),
  batch: vi.fn(),
  confirm: vi.fn(),
  navigate: vi.fn(),
  reconcile: vi.fn(),
  emit: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  accountScope: { value: { ownerId: 'user-a', epoch: 1 } },
  route: { id: 'active' as string | undefined },
}));
vi.mock('@/common', () => ({
  ipcBridge: { conversation: { remove: { invoke: mocks.remove } }, sidebar: { archive: { invoke: mocks.archive } } },
}));
vi.mock('@arco-design/web-react', () => ({
  Modal: { confirm: mocks.confirm },
  Message: { success: mocks.success, error: mocks.error },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-router-dom', () => ({ useParams: () => mocks.route, useNavigate: () => mocks.navigate }));
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync', () => ({
  removeDeletedConversation: mocks.reconcile,
  reconcileSidebarArchive: mocks.archiveReconcile,
  useConversationListScope: () => mocks.accountScope.value,
  isConversationListScopeCurrent: (scope: unknown) => scope === mocks.accountScope.value,
}));
vi.mock('@/renderer/hooks/chat/useSendBoxDraft', () => ({ requestConversationSendBoxPrefill: vi.fn() }));
vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({ refreshConversationCache: vi.fn() }));
vi.mock('@/renderer/utils/emitter', () => ({ emitter: { emit: mocks.emit } }));
vi.mock('@/renderer/utils/ui/focus', () => ({ blockMobileInputFocus: vi.fn(), blurActiveElement: vi.fn() }));

import { useConversationActions } from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversationActions';

const conversation = { id: 'active', name: 'Customer conversation', type: 'aionrs' } as TChatConversation;
const renderActions = (selectedConversationIds = new Set<string>()) =>
  renderHook(() =>
    useConversationActions({
      batchMode: false,
      selectedConversationIds,
      setSelectedConversationIds: mocks.selection,
      onBatchModeChange: mocks.batch,
      toggleSelectedConversation: vi.fn(),
      markAsRead: vi.fn(),
      markManualUnread: vi.fn(),
      clearManualUnread: vi.fn(),
      isManualUnread: () => false,
    })
  );
const confirmation = () => mocks.confirm.mock.calls.at(-1)![0] as { onOk: () => Promise<void> };

describe('customer conversation delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.route.id = 'active';
    mocks.remove.mockResolvedValue({ success: true });
  });

  it('requires the customer to confirm, then removes the row and replaces the active route', async () => {
    const { result } = renderActions();
    act(() => result.current.handleDelete(conversation));
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ okButtonProps: { status: 'danger' } }));
    expect(mocks.remove).not.toHaveBeenCalled();
    await act(() => confirmation().onOk());
    expect(mocks.remove).toHaveBeenCalledWith({ id: 'active' });
    expect(mocks.reconcile).toHaveBeenCalledWith('active');
    expect(mocks.emit).toHaveBeenCalledWith('conversation.deleted', 'active');
    expect(mocks.navigate).toHaveBeenCalledWith('/', { replace: true });
    expect(mocks.success).toHaveBeenCalledWith('conversation.history.deleteSuccess');
  });

  it.each(['reject', 'false'])('keeps the list and route when deletion fails (%s)', async (failure) => {
    if (failure === 'reject') mocks.remove.mockRejectedValue(new Error('request failed'));
    else mocks.remove.mockResolvedValue(false);
    const { result } = renderActions();
    act(() => result.current.handleDelete(conversation));
    await act(() => confirmation().onOk());
    expect(mocks.error).toHaveBeenCalledWith('conversation.history.deleteFailed');
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it('preserves a different route selected while deletion is pending', async () => {
    let finish!: (value: boolean) => void;
    mocks.remove.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const { result, rerender } = renderActions();
    act(() => result.current.handleDelete(conversation));
    let pending!: Promise<void>;
    act(() => {
      pending = confirmation().onOk();
    });
    mocks.route.id = 'another-conversation';
    rerender();
    await act(async () => {
      finish(true);
      await pending;
    });
    expect(mocks.reconcile).toHaveBeenCalledWith('active');
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});

describe('customer conversation archive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.route.id = 'active';
    mocks.archive.mockReset().mockResolvedValue(undefined);
  });

  it('reconciles a successful archive before background refresh and replaces the active route', async () => {
    const { result } = renderActions();
    await act(() => result.current.handleArchive(conversation));
    expect(mocks.archiveReconcile).toHaveBeenCalledWith(
      expect.objectContaining({ item_type: 'conversation', item_id: 'active', archived: true })
    );
    expect(mocks.navigate).toHaveBeenCalledWith('/', { replace: true });
    expect(mocks.emit).toHaveBeenCalledWith('chat.history.refresh');
  });

  it('keeps the list and route when the archive request fails', async () => {
    mocks.archive.mockRejectedValue(new Error('request failed'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderActions();
    await act(() => result.current.handleArchive(conversation));
    expect(mocks.archiveReconcile).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith('conversation.history.archiveFailed');
    log.mockRestore();
  });

  it('does not redirect away from another conversation selected while archive is pending', async () => {
    let finish!: () => void;
    mocks.archive.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      })
    );
    const { result, rerender } = renderActions();
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.handleArchive(conversation);
    });
    mocks.route.id = 'another-conversation';
    rerender();
    await act(async () => {
      finish();
      await pending;
    });
    expect(mocks.archiveReconcile).toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('prunes each successful batch result immediately and keeps failed conversations selected for retry', async () => {
    let fail!: (error: Error) => void;
    mocks.archive.mockImplementation(({ item_id }: { item_id: string }) =>
      item_id === 'active'
        ? Promise.resolve()
        : new Promise((_resolve, reject) => {
            fail = reject;
          })
    );
    const { result } = renderActions(new Set(['active', 'failed']));
    act(() => result.current.handleBatchArchive());
    let pending!: Promise<void>;
    await act(async () => {
      pending = confirmation().onOk();
    });
    expect(mocks.archiveReconcile).toHaveBeenCalledTimes(1);
    expect(mocks.batch).not.toHaveBeenCalled();
    await act(async () => {
      fail(new Error('request failed'));
      await pending;
    });
    expect(mocks.selection).toHaveBeenCalledWith(new Set(['failed']));
    expect(mocks.batch).toHaveBeenCalledWith(true);
    expect(mocks.archiveReconcile).not.toHaveBeenCalledWith(expect.objectContaining({ item_id: 'failed' }));
  });

  it('keeps failed project conversations while immediately reconciling successful ones', async () => {
    mocks.archive.mockImplementation(({ item_id }: { item_id: string }) =>
      item_id === 'active' ? Promise.resolve() : Promise.reject(new Error('request failed'))
    );
    const { result } = renderActions();
    act(() => result.current.handleArchiveProject('Docs', [conversation, { ...conversation, id: 'failed' }]));
    await act(() => result.current.handleArchiveProjectConfirm());
    expect(mocks.archiveReconcile).toHaveBeenCalledTimes(1);
    expect(mocks.archiveReconcile).toHaveBeenCalledWith(expect.objectContaining({ item_id: 'active', archived: true }));
    expect(mocks.success).toHaveBeenCalledWith('conversation.history.batchArchiveSuccess');
  });
});

it.each([false, true])(
  'ignores an old account archive completion after login changes (rejected: %s)',
  async (rejected) => {
    vi.clearAllMocks();
    mocks.accountScope.value = { ownerId: 'user-a', epoch: 1 };
    let finish!: () => void;
    let fail!: (error: Error) => void;
    mocks.archive.mockReturnValue(
      new Promise<void>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      })
    );
    const { result, rerender } = renderActions();
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.handleArchive(conversation);
    });
    mocks.accountScope.value = { ownerId: 'user-b', epoch: 2 };
    rerender();
    await act(async () => {
      if (rejected) fail(new Error('old account request failed'));
      else finish();
      await pending;
    });
    expect(mocks.archiveReconcile).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  }
);

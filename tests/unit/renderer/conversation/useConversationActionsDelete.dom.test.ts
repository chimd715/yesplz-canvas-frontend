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
  confirm: vi.fn(),
  navigate: vi.fn(),
  reconcile: vi.fn(),
  emit: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  route: { id: 'active' as string | undefined },
}));
vi.mock('@/common', () => ({ ipcBridge: { conversation: { remove: { invoke: mocks.remove } } } }));
vi.mock('@arco-design/web-react', () => ({
  Modal: { confirm: mocks.confirm },
  Message: { success: mocks.success, error: mocks.error },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-router-dom', () => ({ useParams: () => mocks.route, useNavigate: () => mocks.navigate }));
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync', () => ({
  removeDeletedConversation: mocks.reconcile,
}));
vi.mock('@/renderer/hooks/chat/useSendBoxDraft', () => ({ requestConversationSendBoxPrefill: vi.fn() }));
vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({ refreshConversationCache: vi.fn() }));
vi.mock('@/renderer/utils/emitter', () => ({ emitter: { emit: mocks.emit } }));
vi.mock('@/renderer/utils/ui/focus', () => ({ blockMobileInputFocus: vi.fn(), blurActiveElement: vi.fn() }));

import { useConversationActions } from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversationActions';

const conversation = { id: 'active', name: 'Customer conversation', type: 'aionrs' } as TChatConversation;
const renderActions = () =>
  renderHook(() =>
    useConversationActions({
      batchMode: false,
      selectedConversationIds: new Set(),
      setSelectedConversationIds: vi.fn(),
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

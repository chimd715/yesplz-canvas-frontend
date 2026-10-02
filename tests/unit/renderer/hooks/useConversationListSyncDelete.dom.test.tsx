/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import { act, renderHook } from '@testing-library/react';
import type { TChatConversation } from '@/common/config/storage';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  changed: vi.fn(),
  stream: vi.fn(),
  completed: vi.fn(),
  listeners: new Map<string, (...args: unknown[]) => void>(),
  mutate: vi.fn(),
  account: { id: 'user-a' as string | null },
  status: { value: 'authenticated' },
}));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({
    user: mocks.account.id ? { id: mocks.account.id } : null,
    status: mocks.account.id ? mocks.status.value : 'unauthenticated',
  }),
}));
vi.mock('swr', () => ({ mutate: mocks.mutate }));
vi.mock('@/renderer/utils/emitter', () => ({
  addEventListener: (name: string, handler: (...args: unknown[]) => void) => {
    mocks.listeners.set(name, handler);
  },
  emitter: { emit: (name: string, ...args: unknown[]) => mocks.listeners.get(name)?.(...args) },
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    database: { getUserConversations: { invoke: mocks.get } },
    application: { writeRendererLog: { invoke: vi.fn().mockResolvedValue(undefined) } },
    conversation: {
      listChanged: { on: mocks.changed },
      responseStream: { on: mocks.stream },
      turnCompleted: { on: mocks.completed },
      confirmation: { remove: { on: vi.fn() } },
    },
  },
}));
let store: typeof import('@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync');
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.listeners.clear();
  mocks.get.mockReset();
  mocks.account.id = 'user-a';
  mocks.status.value = 'authenticated';
  localStorage.clear();
  mocks.mutate.mockResolvedValue(undefined);
  store = await import('@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync');
});

it('removes deleted rows immediately, invalidates cached routes and rejects stale fetches and stream frames', async () => {
  const { useConversationListSync, removeDeletedConversation } = store;
  const deleted = { id: 'deleted', name: 'Hidden', extra: {}, project_id: 'project-1' };
  const kept = { id: 'kept', name: 'Kept', extra: {} };
  mocks.get.mockResolvedValueOnce({ items: [deleted, kept] });
  const { result } = renderHook(() => useConversationListSync());
  await act(async () => {});
  expect(result.current.conversations.map((row) => row.id)).toEqual(['deleted', 'kept']);
  act(() => result.current.markManualUnread('deleted'));

  let finish!: (value: unknown) => void;
  mocks.get.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  act(() => mocks.listeners.get('chat.history.refresh')?.());
  act(() => removeDeletedConversation('deleted'));
  expect(result.current.conversations.map((row) => row.id)).toEqual(['kept']);
  expect(result.current.isManualUnread('deleted')).toBe(false);
  expect(mocks.mutate).toHaveBeenCalledWith('conversation/deleted', null, false);
  await act(async () => finish({ items: [deleted, kept] }));
  expect(result.current.conversations.map((row) => row.id)).toEqual(['kept']);

  const requests = mocks.get.mock.calls.length;
  act(() => mocks.stream.mock.calls[0][0]({ conversation_id: 'deleted', type: 'content', data: {} }));
  act(() => mocks.completed.mock.calls[0][0]({ session_id: 'deleted', state: 'completed' }));
  expect(result.current.isConversationGenerating('deleted')).toBe(false);
  expect(mocks.get).toHaveBeenCalledTimes(requests);

  mocks.get.mockResolvedValue({ items: [kept] });
  act(() => mocks.changed.mock.calls[0][0]({ conversation_id: 'kept', action: 'deleted' }));
  expect(result.current.conversations).toEqual([]);
  await act(async () => {});
  expect(result.current.conversations).toEqual([]);
});

it('archives immediately, ignores a pre-archive response and supports restoring and archiving the same conversation', async () => {
  const archived = {
    id: 'archive-roundtrip',
    name: 'Roundtrip',
    extra: { pinned: true },
    project_id: 'p-1',
  } as TChatConversation;
  const kept = { id: 'archive-kept', name: 'Kept', extra: {} } as TChatConversation;
  mocks.get.mockResolvedValueOnce({ items: [archived, kept] });
  const { result } = renderHook(() => store.useConversationListSync());
  await act(async () => {});
  let finish!: (value: unknown) => void;
  mocks.get.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  act(() => mocks.listeners.get('chat.history.refresh')?.());
  act(() =>
    store.reconcileSidebarArchive({
      scope: store.getConversationListScope(),
      item_type: 'conversation',
      item_id: archived.id,
      archived: true,
    })
  );
  expect(result.current.conversations.map((row) => row.id)).toEqual([kept.id]);
  await act(async () => finish({ items: [archived, kept] }));
  expect(result.current.conversations.map((row) => row.id)).toEqual([kept.id]);
  act(() =>
    store.reconcileSidebarArchive({
      scope: store.getConversationListScope(),
      item_type: 'conversation',
      item_id: archived.id,
      archived: false,
      conversation: archived,
    })
  );
  expect(result.current.conversations.map((row) => row.id)).toEqual([kept.id, archived.id]);
  expect(result.current.conversations.find((row) => row.id === archived.id)?.extra.pinned).toBe(false);
  act(() =>
    store.reconcileSidebarArchive({
      scope: store.getConversationListScope(),
      item_type: 'conversation',
      item_id: archived.id,
      archived: true,
    })
  );
  expect(result.current.conversations.map((row) => row.id)).toEqual([kept.id]);
});

it('keeps the newest list when an older refresh completes later', async () => {
  mocks.get.mockResolvedValueOnce({ items: [] });
  const { result } = renderHook(() => store.useConversationListSync());
  await act(async () => {});
  let finish!: (value: unknown) => void;
  mocks.get.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  act(() => mocks.listeners.get('chat.history.refresh')?.());
  mocks.get.mockResolvedValueOnce({ items: [{ id: 'newest', name: 'Newest', extra: {} }] });
  act(() => mocks.listeners.get('chat.history.refresh')?.());
  await act(async () => {});
  await act(async () => finish({ items: [{ id: 'older', name: 'Older', extra: {} }] }));
  expect(result.current.conversations.map((row) => row.id)).toEqual(['newest']);
});

it('preserves the current list when revalidation fails after a confirmed archive', async () => {
  const archived = { id: 'network-archive', name: 'Archive', extra: {} } as TChatConversation;
  const kept = { id: 'network-kept', name: 'Kept', extra: {} };
  mocks.get.mockResolvedValueOnce({ items: [archived, kept] });
  const { result } = renderHook(() => store.useConversationListSync());
  await act(async () => {});
  act(() =>
    store.reconcileSidebarArchive({
      scope: store.getConversationListScope(),
      item_type: 'conversation',
      item_id: archived.id,
      archived: true,
    })
  );
  mocks.get.mockRejectedValueOnce(new Error('temporary outage'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  act(() => mocks.listeners.get('chat.history.refresh')?.());
  await act(async () => {});
  expect(result.current.conversations.map((row) => row.id)).toEqual([kept.id]);
  log.mockRestore();
});

it('does not restore a deleted conversation through reversible archive reconciliation', async () => {
  const conversation = { id: 'deleted-restore', name: 'Deleted', extra: {} } as TChatConversation;
  mocks.get.mockResolvedValue({ items: [conversation] });
  const { result } = renderHook(() => store.useConversationListSync());
  await act(async () => {});
  act(() => store.removeDeletedConversation(conversation.id));
  act(() =>
    store.reconcileSidebarArchive({
      scope: store.getConversationListScope(),
      item_type: 'conversation',
      item_id: conversation.id,
      archived: false,
      conversation,
    })
  );
  act(() => mocks.listeners.get('chat.history.refresh')?.());
  await act(async () => {});
  expect(result.current.conversations).toEqual([]);
});

it('ignores archived activity until the customer restores the conversation', async () => {
  const conversation = { id: 'archived-stream', name: 'Activity', extra: {} } as TChatConversation;
  mocks.get.mockResolvedValue({ items: [conversation] });
  const { result } = renderHook(() => store.useConversationListSync());
  await act(async () => {});
  act(() =>
    store.reconcileSidebarArchive({
      scope: store.getConversationListScope(),
      item_type: 'conversation',
      item_id: conversation.id,
      archived: true,
    })
  );
  const requests = mocks.get.mock.calls.length;
  act(() => mocks.stream.mock.calls[0][0]({ conversation_id: conversation.id, type: 'start', data: {} }));
  act(() => mocks.completed.mock.calls[0][0]({ session_id: conversation.id, state: 'stopped' }));
  expect(result.current.isConversationGenerating(conversation.id)).toBe(false);
  expect(mocks.get).toHaveBeenCalledTimes(requests);
  act(() =>
    store.reconcileSidebarArchive({
      scope: store.getConversationListScope(),
      item_type: 'conversation',
      item_id: conversation.id,
      archived: false,
      conversation,
    })
  );
  act(() => mocks.stream.mock.calls[0][0]({ conversation_id: conversation.id, type: 'start', data: {} }));
  expect(result.current.isConversationGenerating(conversation.id)).toBe(true);
});

it('accepts authoritative restore/archive state from a fresh server read after a local archive', async () => {
  const conversation = { id: 'canonical-roundtrip', name: 'Canonical', extra: {} } as TChatConversation;
  mocks.get.mockResolvedValueOnce({ items: [conversation] });
  const { result } = renderHook(() => store.useConversationListSync());
  await act(async () => {});
  act(() =>
    store.reconcileSidebarArchive({
      scope: store.getConversationListScope(),
      item_type: 'conversation',
      item_id: conversation.id,
      archived: true,
    })
  );
  mocks.get.mockResolvedValueOnce({ items: [] });
  act(() => mocks.listeners.get('chat.history.refresh')?.());
  await act(async () => {});
  mocks.get.mockResolvedValueOnce({ items: [conversation] });
  act(() => mocks.listeners.get('chat.history.refresh')?.());
  await act(async () => {});
  expect(result.current.conversations.map((row) => row.id)).toEqual([conversation.id]);
  mocks.get.mockResolvedValueOnce({ items: [] });
  act(() => mocks.listeners.get('chat.history.refresh')?.());
  await act(async () => {});
  expect(result.current.conversations).toEqual([]);
});

it('clears previous account data immediately and rejects its delayed list and restore results', async () => {
  const privateRow = {
    id: 'owner-a-private',
    name: 'Owner A private title',
    extra: {},
    project_id: 'owner-a-project',
  } as TChatConversation;
  mocks.get.mockResolvedValueOnce({ items: [privateRow] });
  const { result, rerender } = renderHook(() => store.useConversationListSync());
  await act(async () => {});
  const oldScope = store.getConversationListScope();
  act(() => result.current.markManualUnread(privateRow.id));
  let finishOld!: (value: unknown) => void;
  mocks.get.mockReturnValueOnce(
    new Promise((resolve) => {
      finishOld = resolve;
    })
  );
  act(() => mocks.listeners.get('chat.history.refresh')?.());
  mocks.account.id = null;
  rerender();
  expect(result.current.conversations).toEqual([]);
  expect(store.getSnapshotConversationProjectId(privateRow.id)).toBeUndefined();
  let finishNew!: (value: unknown) => void;
  mocks.get.mockReturnValueOnce(
    new Promise((resolve) => {
      finishNew = resolve;
    })
  );
  mocks.account.id = 'user-b';
  rerender();
  act(() =>
    store.reconcileSidebarArchive({
      scope: oldScope,
      item_type: 'conversation',
      item_id: privateRow.id,
      archived: false,
      conversation: privateRow,
    })
  );
  await act(async () => finishOld({ items: [privateRow] }));
  expect(result.current.conversations).toEqual([]);
  expect(result.current.isManualUnread(privateRow.id)).toBe(false);
  await act(async () => finishNew({ items: [{ id: 'owner-b', name: 'Owner B', extra: {} }] }));
  expect(result.current.conversations.map((row) => row.name)).toEqual(['Owner B']);
});

it('clears deleted ids on owner change and does not bind a stale user while authentication is checking', async () => {
  const row = { id: 'account-scoped-id', name: 'First account', extra: {} };
  mocks.get.mockResolvedValueOnce({ items: [row] });
  const { result, rerender } = renderHook(() => store.useConversationListSync());
  await act(async () => {});
  act(() => store.removeDeletedConversation(row.id));
  mocks.status.value = 'checking';
  rerender();
  expect(store.getConversationListScope().ownerId).toBeNull();
  expect(result.current.conversations).toEqual([]);
  mocks.account.id = 'user-b';
  mocks.status.value = 'authenticated';
  mocks.get.mockResolvedValueOnce({ items: [{ ...row, name: 'Second account' }] });
  rerender();
  await act(async () => {});
  expect(result.current.conversations.map((item) => item.name)).toEqual(['Second account']);
});

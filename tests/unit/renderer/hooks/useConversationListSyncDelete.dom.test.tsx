/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  changed: vi.fn(),
  stream: vi.fn(),
  completed: vi.fn(),
  listeners: new Map<string, (...args: unknown[]) => void>(),
  mutate: vi.fn(),
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
import {
  removeDeletedConversation,
  useConversationListSync,
} from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync';

it('removes deleted rows immediately, invalidates cached routes and rejects stale fetches and stream frames', async () => {
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

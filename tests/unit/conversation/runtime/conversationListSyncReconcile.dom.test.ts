/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reconcile wiring: `reconcileGeneratingFromRuntime` lets an authoritative
 * runtime summary (hydrate / send-accepted) relight the sidebar spinner when a
 * WS stream frame was missed (window reload/reconnect race). It must only
 * ever turn the flag ON — clearing stays exclusively with terminal stream
 * frames / turn.completed.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';

vi.mock('@/common', () => ({
  ipcBridge: {
    database: {
      getUserConversations: {
        invoke: vi.fn().mockResolvedValue({
          items: [{ id: 'active-core', logical_conversation_id: 'logical-chat', project_id: 'project-1' }],
        }),
      },
    },
    conversation: {
      listChanged: { on: vi.fn(() => () => {}) },
      responseStream: { on: vi.fn(() => () => {}) },
      turnCompleted: { on: () => () => {} },
      confirmation: { list: { invoke: vi.fn() }, remove: { on: vi.fn(() => () => {}) } },
    },
    application: {
      writeRendererLog: { invoke: vi.fn().mockResolvedValue(undefined) },
    },
  },
}));

vi.mock('@/renderer/utils/emitter', () => ({ addEventListener: () => () => {} }));

import {
  reconcileGeneratingFromRuntime,
  getSnapshotConversationProjectId,
  useConversationListSync,
} from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync';

describe('reconcileGeneratingFromRuntime', () => {
  // Each test uses a distinct conversation id (conv-a/b/c/d) since the store
  // backing this hook is module-level and persists across tests in this file.

  it('marks a conversation generating when isProcessing is true', () => {
    const { result } = renderHook(() => useConversationListSync());

    act(() => {
      reconcileGeneratingFromRuntime('conv-a', true);
    });

    expect(result.current.isConversationGenerating('conv-a')).toBe(true);
  });

  it('does not touch other conversations when reconciling one id', () => {
    const { result } = renderHook(() => useConversationListSync());

    act(() => {
      reconcileGeneratingFromRuntime('conv-b', true);
    });

    expect(result.current.isConversationGenerating('conv-b')).toBe(true);
    expect(result.current.isConversationGenerating('conv-c')).toBe(false);
  });

  it('leaves the generating state unchanged when isProcessing is false', () => {
    const { result } = renderHook(() => useConversationListSync());

    act(() => {
      reconcileGeneratingFromRuntime('conv-d', false);
    });

    expect(result.current.isConversationGenerating('conv-d')).toBe(false);
  });

  it('resolves the project under both logical and active Core IDs without inventing unknown entries', async () => {
    renderHook(() => useConversationListSync());

    await waitFor(() => expect(getSnapshotConversationProjectId('logical-chat')).toBe('project-1'));
    expect(getSnapshotConversationProjectId('active-core')).toBe('project-1');
    expect(getSnapshotConversationProjectId('unknown')).toBeUndefined();
  });
});

describe('waiting confirmation removal', () => {
  it('clears an answered request alias while preserving another pending question during generation', async () => {
    const { result } = renderHook(() => useConversationListSync());
    const stream = vi.mocked(ipcBridge.conversation.responseStream.on).mock.calls[0]![0];
    const remove = vi.mocked(ipcBridge.conversation.confirmation.remove.on).mock.calls[0]![0];
    vi.mocked(ipcBridge.conversation.confirmation.list.invoke).mockResolvedValue([
      { id: 'confirmation-b', call_id: 'request-b', description: '', options: [] },
    ]);

    act(() => {
      stream({ conversation_id: 'ask-alias', type: 'ask', data: { request_id: 'request-a' } });
      stream({ conversation_id: 'ask-alias', type: 'ask', data: { request_id: 'request-b' } });
      stream({ conversation_id: 'ask-alias', type: 'thought', data: {} });
    });
    expect(result.current.isConversationWaitingConfirmation('ask-alias')).toBe(true);

    await act(async () => remove({ conversation_id: 'ask-alias', id: 'confirmation-a' }));
    expect(result.current.isConversationWaitingConfirmation('ask-alias')).toBe(true);

    vi.mocked(ipcBridge.conversation.confirmation.list.invoke).mockResolvedValue([]);
    await act(async () => remove({ conversation_id: 'ask-alias', id: 'confirmation-b' }));
    expect(result.current.isConversationWaitingConfirmation('ask-alias')).toBe(false);
  });

  it('ignores an older empty confirmation response when a new question arrives', async () => {
    const { result } = renderHook(() => useConversationListSync());
    const stream = vi.mocked(ipcBridge.conversation.responseStream.on).mock.calls[0]![0];
    const remove = vi.mocked(ipcBridge.conversation.confirmation.remove.on).mock.calls[0]![0];
    let finishLookup!: (value: []) => void;
    vi.mocked(ipcBridge.conversation.confirmation.list.invoke).mockReturnValue(
      new Promise((resolve) => {
        finishLookup = resolve;
      })
    );

    act(() => {
      stream({ conversation_id: 'ask-race', type: 'ask', data: { request_id: 'old-request' } });
      remove({ conversation_id: 'ask-race', id: 'old-confirmation' });
      stream({ conversation_id: 'ask-race', type: 'ask', data: { request_id: 'new-request' } });
    });
    await act(async () => finishLookup([]));
    expect(result.current.isConversationWaitingConfirmation('ask-race')).toBe(true);
  });

  it('preserves pending questions when their confirmation lookup fails', async () => {
    const { result } = renderHook(() => useConversationListSync());
    const stream = vi.mocked(ipcBridge.conversation.responseStream.on).mock.calls[0]![0];
    const remove = vi.mocked(ipcBridge.conversation.confirmation.remove.on).mock.calls[0]![0];
    vi.mocked(ipcBridge.conversation.confirmation.list.invoke).mockRejectedValue(new Error('Unavailable'));

    act(() => stream({ conversation_id: 'ask-unavailable', type: 'ask', data: { request_id: 'request' } }));
    await act(async () => remove({ conversation_id: 'ask-unavailable', id: 'confirmation' }));
    expect(result.current.isConversationWaitingConfirmation('ask-unavailable')).toBe(true);
  });
});

describe('conversation list pagination', () => {
  const invoke = vi.mocked(ipcBridge.database.getUserConversations.invoke);
  const conversation = (id: string): TChatConversation =>
    ({ id, name: id, logical_conversation_id: `logical-${id}`, project_id: 'project-1' }) as TChatConversation;
  const refresh = async () => {
    await act(async () => {
      vi.mocked(ipcBridge.conversation.listChanged.on).mock.calls[0]![0]({
        action: 'updated',
        conversation_id: 'pagination',
      });
    });
  };

  beforeEach(() => {
    invoke.mockReset().mockResolvedValue({ items: [], total: 0, has_more: false });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads more than 200 rows using the unfiltered cursor and removes overlapping rows', async () => {
    const rows = Array.from({ length: 205 }, (_, index) => conversation(`page-${index}`));
    rows[199] = { ...rows[199]!, extra: { team_id: 'team-1' } } as TChatConversation;
    invoke
      .mockResolvedValueOnce({ items: rows.slice(0, 200), total: 205, has_more: true })
      .mockResolvedValueOnce({ items: [rows[198]!, ...rows.slice(200)], total: 205, has_more: false });
    const { result } = renderHook(() => useConversationListSync());

    await refresh();

    expect(result.current.conversations).toHaveLength(204);
    expect(invoke.mock.calls.map(([query]) => query)).toEqual([{ limit: 200 }, { limit: 200, cursor: 'page-199' }]);
    expect(getSnapshotConversationProjectId('logical-page-204')).toBe('project-1');
  });

  it('continues a short native page while has_more is true', async () => {
    invoke
      .mockResolvedValueOnce({ items: [conversation('short-1')], total: 3, has_more: true })
      .mockResolvedValueOnce({ items: [conversation('short-2')], total: 3, has_more: false });
    const { result } = renderHook(() => useConversationListSync());

    await refresh();

    expect(result.current.conversations.map((row) => row.id)).toEqual(['short-1', 'short-2']);
    expect(invoke).toHaveBeenLastCalledWith({ limit: 200, cursor: 'short-1' });
  });

  it('retains the loaded snapshot when a later page fails', async () => {
    invoke.mockResolvedValueOnce({ items: [conversation('kept')], total: 1, has_more: false });
    const { result } = renderHook(() => useConversationListSync());
    await refresh();
    const previous = result.current.conversations;
    invoke
      .mockResolvedValueOnce({ items: [conversation('replacement')], total: 201, has_more: true })
      .mockRejectedValueOnce(new Error('History unavailable'));

    await refresh();

    expect(result.current.conversations).toBe(previous);
    expect(getSnapshotConversationProjectId('logical-kept')).toBe('project-1');
    expect(console.error).toHaveBeenCalled();
  });

  it.each([
    { name: 'empty', items: [] },
    { name: 'malformed', items: [{ ...conversation('invalid'), id: '' }] },
  ])('retains the loaded snapshot when the $name page has no usable next cursor', async ({ items }) => {
    const { result } = renderHook(() => useConversationListSync());
    const previous = result.current.conversations;
    invoke.mockResolvedValueOnce({ items, total: 201, has_more: true });

    await refresh();

    expect(result.current.conversations).toBe(previous);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalled();
  });

  it('stops a repeated cursor without replacing the loaded snapshot', async () => {
    const { result } = renderHook(() => useConversationListSync());
    const previous = result.current.conversations;
    invoke.mockResolvedValue({ items: [conversation('repeated')], total: 201, has_more: true });

    await refresh();

    expect(result.current.conversations).toBe(previous);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalled();
  });

  it('keeps the newer refresh when an older page returns later', async () => {
    let finishOlder!: (page: { items: TChatConversation[]; total: number; has_more: boolean }) => void;
    invoke
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOlder = resolve;
          })
      )
      .mockResolvedValueOnce({ items: [conversation('newer')], total: 1, has_more: false });
    const { result } = renderHook(() => useConversationListSync());

    await refresh();
    await refresh();
    await act(async () => finishOlder({ items: [conversation('older')], total: 1, has_more: false }));

    expect(result.current.conversations.map((row) => row.id)).toEqual(['newer']);
  });
});

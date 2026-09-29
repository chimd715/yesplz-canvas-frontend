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
import { describe, expect, it, vi } from 'vitest';
import { ipcBridge } from '@/common';

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
      listChanged: { on: () => () => {} },
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

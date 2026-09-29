/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { Message } from '@arco-design/web-react';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import type { TConversationRuntimeSummary } from '@/common/config/storage';
import { createElement, type PropsWithChildren } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ConversationCommandQueueRuntimeGate,
  clearScopedCommandQueues,
  commandQueueAuthEpoch,
  getRetainedLogicalRequests,
  resetConversationCommandQueueBackgroundRunnerForTest,
  useConversationCommandQueue,
} from '@/renderer/pages/conversation/platforms/useConversationCommandQueue';
import {
  nativeAdmissionCapability,
  submitNativeRequest,
} from '@/renderer/pages/conversation/platforms/aionrs/durableAdmission';
import { resetConversationRuntimeViewStoreForTest } from '@/renderer/pages/conversation/runtime/conversationRuntimeViewStore';

const turnCompletedListeners = vi.hoisted(() => ({
  current: [] as Array<
    (event: { session_id: string; turn_id: string; state: string; runtime: TConversationRuntimeSummary }) => void
  >,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      turnCompleted: {
        on: vi.fn((listener) => {
          turnCompletedListeners.current.push(listener);
          return () => {
            turnCompletedListeners.current = turnCompletedListeners.current.filter((item) => item !== listener);
          };
        }),
      },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

vi.mock('@arco-design/web-react', () => ({
  Message: {
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

const createSwrWrapper = () => {
  const cache = new Map();

  return function SwrTestWrapper({ children }: PropsWithChildren) {
    return createElement(
      SWRConfig,
      {
        value: {
          provider: () => cache,
          dedupingInterval: 0,
          revalidateOnFocus: false,
          revalidateOnReconnect: false,
        },
      },
      children
    );
  };
};

const processingGate: ConversationCommandQueueRuntimeGate = {
  hydrated: true,
  canSendMessage: true,
  isProcessing: true,
};

const idleGate: ConversationCommandQueueRuntimeGate = {
  hydrated: true,
  canSendMessage: true,
  isProcessing: false,
};

const runtime = (overrides: Partial<TConversationRuntimeSummary> = {}): TConversationRuntimeSummary => ({
  state: 'idle',
  can_send_message: true,
  has_task: false,
  task_status: 'finished',
  is_processing: false,
  pending_confirmations: 0,
  turn_id: null,
  ...overrides,
});

const busyError = () =>
  new BackendHttpError({
    method: 'POST',
    path: '/api/conversations/conv/messages',
    status: 409,
    body: {
      success: false,
      code: 'CONFLICT',
      error: 'conversation conv is already running',
    },
  });

const runtimeUnavailableError = () =>
  new BackendHttpError({
    method: 'POST',
    path: '/api/conversations/conv/messages',
    status: 409,
    body: {
      success: false,
      code: 'CONFLICT',
      error: 'conversation runtime is shutting down',
    },
  });

const storageKey = (conversationId: string) => `conversation-command-queue/${conversationId}`;

const emitTurnCompleted = (conversationId: string): void => {
  act(() => {
    turnCompletedListeners.current.forEach((listener) => {
      listener({
        session_id: conversationId,
        turn_id: 'turn-1',
        state: 'ai_waiting_input',
        runtime: runtime(),
      });
    });
  });
};

const renderQueue = ({
  conversation_id,
  runtimeGate,
  isBusy = false,
  onExecute = vi.fn().mockResolvedValue(undefined),
}: {
  conversation_id: string;
  runtimeGate: ConversationCommandQueueRuntimeGate;
  isBusy?: boolean;
  onExecute?: (item: Parameters<Parameters<typeof useConversationCommandQueue>[0]['onExecute']>[0]) => Promise<void>;
}) =>
  renderHook(
    ({ gate, busy }) =>
      useConversationCommandQueue({
        conversation_id,
        enabled: true,
        isBusy: busy,
        runtimeGate: gate,
        onExecute,
      }),
    {
      initialProps: { gate: runtimeGate, busy: isBusy },
      wrapper: createSwrWrapper(),
    }
  );

describe('useConversationCommandQueue drain', () => {
  beforeEach(() => {
    sessionStorage.clear();
    turnCompletedListeners.current = [];
    resetConversationRuntimeViewStoreForTest();
    resetConversationCommandQueueBackgroundRunnerForTest();
    vi.clearAllMocks();
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    resetConversationRuntimeViewStoreForTest();
    resetConversationCommandQueueBackgroundRunnerForTest();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('drains a queued command when the runtime becomes idle', async () => {
    const onExecute = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderQueue({
      conversation_id: 'conv-1',
      runtimeGate: processingGate,
      onExecute,
    });

    act(() => {
      result.current.toggleMode();
    });
    await waitFor(() => expect(result.current.mode).toBe('auto'));

    act(() => {
      result.current.enqueue({ input: 'queued follow-up', files: [] });
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    rerender({ gate: idleGate, busy: false });

    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1));
    expect(onExecute).toHaveBeenCalledWith(expect.objectContaining({ input: 'queued follow-up' }));
  });

  it('ignores legacy persisted team-upgrade handoff state and drains normally', async () => {
    const onExecute = vi.fn().mockResolvedValue(undefined);
    const legacyHandoffKey = ['deferred', 'AfterTeamUpgrade'].join('');
    sessionStorage.setItem(
      storageKey('conv-legacy'),
      JSON.stringify({
        items: [
          {
            id: 'queued-1',
            input: 'legacy persisted follow-up',
            files: [],
            created_at: 1,
          },
        ],
        isPaused: false,
        mode: 'auto',
        [legacyHandoffKey]: true,
      })
    );

    renderQueue({
      conversation_id: 'conv-legacy',
      runtimeGate: idleGate,
      onExecute,
    });

    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1));
    expect(onExecute).toHaveBeenCalledWith(expect.objectContaining({ input: 'legacy persisted follow-up' }));
    await waitFor(() =>
      expect(JSON.parse(sessionStorage.getItem(storageKey('conv-legacy')) ?? '{}')).toMatchObject({
        items: [],
        mode: 'auto',
      })
    );
  });

  it('continues auto-draining when a send finishes before a busy state is observed', async () => {
    const onExecute = vi.fn().mockResolvedValue(undefined);
    sessionStorage.setItem(
      storageKey('conv-fast-finish'),
      JSON.stringify({
        items: [
          { id: 'queued-fast-1', input: 'first fast command', files: [], created_at: 1 },
          { id: 'queued-fast-2', input: 'second fast command', files: [], created_at: 2 },
        ],
        isPaused: false,
        mode: 'auto',
      })
    );

    renderQueue({
      conversation_id: 'conv-fast-finish',
      runtimeGate: idleGate,
      onExecute,
    });

    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(2));
    expect(onExecute).toHaveBeenNthCalledWith(1, expect.objectContaining({ input: 'first fast command' }));
    expect(onExecute).toHaveBeenNthCalledWith(2, expect.objectContaining({ input: 'second fast command' }));
  });

  it('continues draining queued commands after the active conversation hook unmounts', async () => {
    const onExecute = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderQueue({
      conversation_id: 'conv-background',
      runtimeGate: processingGate,
      onExecute,
    });

    act(() => {
      result.current.toggleMode();
    });
    await waitFor(() => expect(result.current.mode).toBe('auto'));

    act(() => {
      result.current.enqueue({ input: 'queued after switch', files: [] });
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    unmount();

    expect(onExecute).not.toHaveBeenCalled();

    emitTurnCompleted('conv-background');

    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1));
    expect(onExecute).toHaveBeenCalledWith(expect.objectContaining({ input: 'queued after switch' }));
  });

  it('keeps manual-mode commands queued after the active conversation hook unmounts', async () => {
    const onExecute = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderQueue({
      conversation_id: 'conv-background-manual',
      runtimeGate: processingGate,
      onExecute,
    });

    expect(result.current.mode).toBe('manual');

    act(() => {
      result.current.enqueue({ input: 'send only when requested', files: [] });
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    unmount();
    emitTurnCompleted('conv-background-manual');

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onExecute).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem(storageKey('conv-background-manual')) ?? '{}')).toMatchObject({
      mode: 'manual',
      items: [expect.objectContaining({ input: 'send only when requested' })],
    });
  });

  it('shares the background listener across active queues and releases it after the last runner unmounts', () => {
    const firstExecute = vi.fn().mockResolvedValue(undefined);
    const secondExecute = vi.fn().mockResolvedValue(undefined);
    const firstQueue = renderQueue({
      conversation_id: 'conv-active-one',
      runtimeGate: idleGate,
      onExecute: firstExecute,
    });
    const secondQueue = renderQueue({
      conversation_id: 'conv-active-two',
      runtimeGate: idleGate,
      onExecute: secondExecute,
    });

    expect(turnCompletedListeners.current).toHaveLength(1);

    emitTurnCompleted('conv-active-two');

    expect(firstExecute).not.toHaveBeenCalled();
    expect(secondExecute).not.toHaveBeenCalled();

    firstQueue.unmount();
    expect(turnCompletedListeners.current).toHaveLength(1);

    secondQueue.unmount();
    expect(turnCompletedListeners.current).toHaveLength(0);
  });

  it('continues draining remaining background commands after each successful send', async () => {
    const onExecute = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderQueue({
      conversation_id: 'conv-background-many',
      runtimeGate: processingGate,
      onExecute,
    });

    act(() => {
      result.current.toggleMode();
    });
    await waitFor(() => expect(result.current.mode).toBe('auto'));

    act(() => {
      result.current.enqueue({ input: 'first queued command', files: [] });
      result.current.enqueue({ input: 'second queued command', files: [] });
    });
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    unmount();
    emitTurnCompleted('conv-background-many');

    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(2));
    expect(onExecute).toHaveBeenNthCalledWith(1, expect.objectContaining({ input: 'first queued command' }));
    expect(onExecute).toHaveBeenNthCalledWith(2, expect.objectContaining({ input: 'second queued command' }));
    await waitFor(() =>
      expect(JSON.parse(sessionStorage.getItem(storageKey('conv-background-many')) ?? '{}')).toMatchObject({
        items: [],
        mode: 'auto',
      })
    );
  });

  it('pauses and restores the background command when execution fails', async () => {
    const onExecute = vi.fn().mockRejectedValue(new Error('send failed'));
    const { result, unmount } = renderQueue({
      conversation_id: 'conv-background-failure',
      runtimeGate: processingGate,
      onExecute,
    });

    act(() => {
      result.current.toggleMode();
    });
    await waitFor(() => expect(result.current.mode).toBe('auto'));

    act(() => {
      result.current.enqueue({ input: 'retry me later', files: [] });
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    unmount();
    emitTurnCompleted('conv-background-failure');

    await waitFor(() => expect(Message.warning).toHaveBeenCalledTimes(1));
    const persistedState = JSON.parse(sessionStorage.getItem(storageKey('conv-background-failure')) ?? '{}');
    expect(persistedState).toMatchObject({
      isPaused: true,
      items: [expect.objectContaining({ input: 'retry me later' })],
    });
  });

  it('restores a foreground busy command and waits for gate release without warning', async () => {
    const onExecute = vi.fn().mockRejectedValueOnce(busyError()).mockResolvedValueOnce(undefined);
    const { result, rerender } = renderQueue({
      conversation_id: 'conv-busy-foreground',
      runtimeGate: idleGate,
      onExecute,
    });

    act(() => {
      result.current.toggleMode();
    });
    await waitFor(() => expect(result.current.mode).toBe('auto'));

    act(() => {
      result.current.enqueue({ input: 'queued while busy', files: [] });
    });

    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(Message.warning).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onExecute).toHaveBeenCalledTimes(1);

    rerender({ gate: processingGate, busy: true });
    rerender({ gate: idleGate, busy: false });

    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(2));
  });

  it('retries after release when the blocked gate was observed before the busy catch', async () => {
    const rerenderQueueRef: { current: ReturnType<typeof renderQueue>['rerender'] } = { current: () => undefined };
    let attempts = 0;
    const onExecute = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        rerenderQueueRef.current({ gate: processingGate, busy: true });
        await new Promise((resolve) => setTimeout(resolve, 0));
        throw busyError();
      }
    });
    const { result, rerender } = renderQueue({
      conversation_id: 'conv-busy-preobserved-gate',
      runtimeGate: idleGate,
      onExecute,
    });
    rerenderQueueRef.current = rerender;

    act(() => {
      result.current.toggleMode();
    });
    await waitFor(() => expect(result.current.mode).toBe('auto'));

    act(() => {
      result.current.enqueue({ input: 'retry after already observed blocked gate', files: [] });
    });

    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(Message.warning).not.toHaveBeenCalled();

    rerender({ gate: idleGate, busy: false });

    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(2));
  });

  it('does not detach into a background drain when onExecute identity changes while mounted', async () => {
    const firstExecute = vi.fn().mockResolvedValue(undefined);
    const secondExecute = vi.fn().mockResolvedValue(undefined);
    const wrapper = createSwrWrapper();
    const { result, rerender } = renderHook(
      ({ gate, execute }) =>
        useConversationCommandQueue({
          conversation_id: 'conv-stable-runner',
          enabled: true,
          isBusy: gate.isProcessing || !gate.canSendMessage,
          runtimeGate: gate,
          onExecute: execute,
        }),
      { initialProps: { gate: processingGate, execute: firstExecute }, wrapper }
    );

    act(() => {
      result.current.toggleMode();
    });
    await waitFor(() => expect(result.current.mode).toBe('auto'));

    act(() => {
      result.current.enqueue({ input: 'send once', files: [] });
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    rerender({ gate: processingGate, execute: secondExecute });
    emitTurnCompleted('conv-stable-runner');
    expect(firstExecute).not.toHaveBeenCalled();
    expect(secondExecute).not.toHaveBeenCalled();

    rerender({ gate: idleGate, execute: secondExecute });
    await waitFor(() => expect(secondExecute).toHaveBeenCalledTimes(1));
    expect(firstExecute).not.toHaveBeenCalled();
  });

  it('restores a runtime-unavailable busy command without warning or rapid retry', async () => {
    const onExecute = vi.fn().mockRejectedValueOnce(runtimeUnavailableError()).mockResolvedValueOnce(undefined);
    const { result, rerender } = renderQueue({
      conversation_id: 'conv-runtime-unavailable',
      runtimeGate: idleGate,
      onExecute,
    });

    act(() => {
      result.current.toggleMode();
    });
    await waitFor(() => expect(result.current.mode).toBe('auto'));

    act(() => {
      result.current.enqueue({ input: 'queued while runtime closes', files: [] });
    });

    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(Message.warning).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onExecute).toHaveBeenCalledTimes(1);

    rerender({ gate: processingGate, busy: true });
    rerender({ gate: idleGate, busy: false });

    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(2));
  });

  it('restores a background busy command and waits for turn completion before retrying', async () => {
    const onExecute = vi.fn().mockRejectedValueOnce(busyError()).mockResolvedValueOnce(undefined);
    const { result, unmount } = renderQueue({
      conversation_id: 'conv-background-busy',
      runtimeGate: processingGate,
      onExecute,
    });

    act(() => {
      result.current.toggleMode();
    });
    await waitFor(() => expect(result.current.mode).toBe('auto'));

    act(() => {
      result.current.enqueue({ input: 'retry after turn completion', files: [] });
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    unmount();
    emitTurnCompleted('conv-background-busy');

    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1));
    expect(Message.warning).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem(storageKey('conv-background-busy')) ?? '{}')).toMatchObject({
      isPaused: false,
      items: [expect.objectContaining({ input: 'retry after turn completion' })],
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onExecute).toHaveBeenCalledTimes(1);

    emitTurnCompleted('conv-background-busy');

    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(JSON.parse(sessionStorage.getItem(storageKey('conv-background-busy')) ?? '{}')).toMatchObject({
        items: [],
        mode: 'auto',
      })
    );
  });
});

const pendingContext = {
  logicalId: 'logical',
  coreId: 'durable',
  runtimeGeneration: '11111111-1111-4111-8111-111111111111',
  headGeneration: 2,
};
const requestId = '22222222-2222-4222-8222-222222222222';

describe('durable command admission', () => {
  beforeEach(() => {
    sessionStorage.clear();
    clearScopedCommandQueues();
  });

  it('reads original logical intents across Core continuations only within their owner/project, without changing stored context', () => {
    const item = {
      id: 'intent',
      input: 'Keep my prompt',
      files: [],
      created_at: 1,
      pending: true,
      request: { requestId, context: pendingContext },
    };
    const state = JSON.stringify({ items: [item], mode: 'manual', isPaused: true });
    sessionStorage.setItem(storageKey('scoped/owner/project/durable'), state);
    sessionStorage.setItem(storageKey('scoped/other/project/durable'), state);
    expect(getRetainedLogicalRequests('owner/project', 'logical')).toEqual([expect.objectContaining(item)]);
    expect(getRetainedLogicalRequests('owner/project', 'another-logical')).toEqual([]);
    expect(sessionStorage.getItem(storageKey('scoped/owner/project/durable'))).toBe(state);
  });

  it('persists before send, preserves uncertain input, and only looks up after remount', async () => {
    const key = storageKey('scoped/owner/project/durable');
    const execute = vi.fn(async () => {
      const stored = JSON.parse(sessionStorage.getItem(key)!);
      expect(stored.items[0]).toMatchObject({ pending: true, input: 'Keep my prompt', request: { requestId } });
      return false as const;
    });
    const options = {
      conversation_id: 'durable',
      storageScope: 'owner/project',
      retainUntilAccepted: true,
      isBusy: false,
      runtimeGate: idleGate,
      onExecute: execute,
      prepareItem: (item: Parameters<Parameters<typeof useConversationCommandQueue>[0]['onExecute']>[0]) => ({
        ...item,
        request: { requestId, context: pendingContext },
      }),
    };
    const queue = renderHook(() => useConversationCommandQueue(options), { wrapper: createSwrWrapper() });
    await waitFor(() => expect(queue.result.current.items).toEqual([]));
    let itemId = '';
    act(() => {
      itemId = queue.result.current.enqueue({ input: 'Keep my prompt', files: [] })!.id;
    });
    await act(() => queue.result.current.sendNow(itemId));
    act(() => {
      queue.result.current.remove(itemId);
      queue.result.current.clear();
    });
    await waitFor(() => expect(queue.result.current.items[0]?.pending).toBe(true));
    expect(queue.result.current.update(itemId, { input: 'Different intent' })).toBe(false);
    queue.unmount();
    execute.mockClear();
    const restored = renderHook(() => useConversationCommandQueue(options), { wrapper: createSwrWrapper() });
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect(execute.mock.calls[0]).toEqual([
      expect.objectContaining({ request: { requestId, context: pendingContext } }),
      'lookup',
    ]);
    restored.unmount();
  });

  it('keeps different owners separate and refuses late storage writes after logout', async () => {
    const key = storageKey('scoped/first/project/durable');
    let finish!: () => void;
    const execute = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const options = {
      conversation_id: 'durable',
      storageScope: 'first/project',
      retainUntilAccepted: true,
      isBusy: false,
      runtimeGate: idleGate,
      onExecute: execute,
      prepareItem: (item: Parameters<Parameters<typeof useConversationCommandQueue>[0]['onExecute']>[0]) => ({
        ...item,
        request: { requestId, context: pendingContext },
      }),
    };
    const wrapper = createSwrWrapper();
    const first = renderHook(() => useConversationCommandQueue(options), { wrapper });
    await waitFor(() => expect(first.result.current.items).toEqual([]));
    let itemId = '';
    act(() => {
      itemId = first.result.current.enqueue({ input: 'Private prompt', files: [] })!.id;
    });
    let sending!: Promise<void>;
    act(() => {
      sending = first.result.current.sendNow(itemId);
    });
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    const other = renderHook(() => useConversationCommandQueue({ ...options, storageScope: 'second/project' }), {
      wrapper: createSwrWrapper(),
    });
    expect(other.result.current.items).toEqual([]);
    act(() => clearScopedCommandQueues());
    await act(async () => {
      finish();
      await sending;
    });
    expect(sessionStorage.getItem(key)).toBeNull();
    first.unmount();
    other.unmount();
    execute.mockClear();
    const loggedInAgain = renderHook(() => useConversationCommandQueue(options), { wrapper });
    await waitFor(() => expect(loggedInAgain.result.current.items).toEqual([]));
    expect(execute).not.toHaveBeenCalled();
    loggedInAgain.unmount();
  });
  it('retains accepted input for status reconciliation without resending it', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce('recorded')
      .mockResolvedValueOnce('recorded')
      .mockResolvedValueOnce(undefined);
    const options = {
      conversation_id: 'recorded',
      storageScope: 'owner/project',
      retainUntilAccepted: true,
      isBusy: false,
      runtimeGate: idleGate,
      onExecute: execute,
      prepareItem: (item: Parameters<Parameters<typeof useConversationCommandQueue>[0]['onExecute']>[0]) => ({
        ...item,
        request: { requestId, context: { ...pendingContext, coreId: 'recorded' } },
      }),
    };
    const first = renderHook(() => useConversationCommandQueue(options), { wrapper: createSwrWrapper() });
    let itemId = '';
    act(() => {
      itemId = first.result.current.enqueue({ input: 'Accepted text', files: [] })!.id;
    });
    await act(() => first.result.current.sendNow(itemId));
    expect(first.result.current.items[0]).toMatchObject({ pending: true, recorded: true });
    first.unmount();
    const restored = renderHook(() => useConversationCommandQueue(options), { wrapper: createSwrWrapper() });
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(execute.mock.calls[1][1]).toBe('lookup');
    await act(() => restored.result.current.sendNow(itemId));
    expect(execute.mock.calls[2][1]).toBe('reconcile');
    await waitFor(() => expect(restored.result.current.items).toEqual([]));
    restored.unmount();
  });

  it('does not dispatch when storage fails and assigns changed drafts a fresh identity', async () => {
    const execute = vi.fn();
    const options = {
      conversation_id: 'storage-failure',
      storageScope: 'owner/project',
      retainUntilAccepted: true,
      isBusy: false,
      runtimeGate: idleGate,
      onExecute: execute,
      prepareItem: (item: Parameters<Parameters<typeof useConversationCommandQueue>[0]['onExecute']>[0]) => ({
        ...item,
        request: { requestId: crypto.randomUUID(), context: pendingContext },
      }),
    };
    const queue = renderHook(() => useConversationCommandQueue(options), { wrapper: createSwrWrapper() });
    const storage = window.sessionStorage;
    const set = vi.spyOn(window, 'sessionStorage', 'get').mockReturnValue({
      getItem: storage.getItem.bind(storage),
      setItem: () => {
        throw new Error('Quota exceeded');
      },
    } as Storage);
    expect(() => queue.result.current.enqueue({ input: 'Keep in composer', files: [] })).toThrow('Quota exceeded');
    expect(execute).not.toHaveBeenCalled();
    expect(queue.result.current.items).toEqual([]);
    set.mockRestore();
    let item: ReturnType<typeof queue.result.current.enqueue>;
    act(() => {
      item = queue.result.current.enqueue({ input: 'Original', files: [] });
    });
    act(() => {
      queue.result.current.update(item!.id, { input: 'Edited' });
    });
    await waitFor(() => expect(queue.result.current.items[0].input).toBe('Edited'));
    expect(queue.result.current.items[0].request!.requestId).not.toBe(item!.request!.requestId);
    queue.unmount();
    const epoch = commandQueueAuthEpoch();
    const blocked = vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new Error('Blocked storage');
    });
    expect(() => clearScopedCommandQueues()).not.toThrow();
    expect(commandQueueAuthEpoch()).toBe(epoch + 1);
    blocked.mockRestore();
  });
});

describe('native admission transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.querySelector('meta[name="ai-builder-preview"]')?.remove();
  });

  it.each([404, 409, 503])('never downgrades hosted capability status %s to legacy sending', async (status) => {
    const marker = document.createElement('meta');
    marker.name = 'ai-builder-preview';
    marker.content = 'enabled';
    document.head.append(marker);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status }))
    );
    await expect(nativeAdmissionCapability('durable')).rejects.toMatchObject({ status });
  });

  it('sends the frozen request and rejects a receipt for another request or input', async () => {
    const pending = { requestId, context: pendingContext };
    const record = {
      ...pending,
      prompt: { client_request_id: requestId, content: 'Original text', hidden: false },
      receipt: { client_request_id: requestId, msg_id: 'message', turn_id: 'turn' },
    };
    const fetchMock = vi.fn(async (_url: string, _options: RequestInit) => Response.json(record));
    vi.stubGlobal('fetch', fetchMock);
    const accepted = await submitNativeRequest(pending, 'Original text', 'send');
    expect(accepted?.runtime).toBeUndefined();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      context: pendingContext,
      prompt: record.prompt,
    });
    fetchMock.mockImplementation(async () =>
      Response.json({ ...record, prompt: { ...record.prompt, content: 'Changed' } })
    );
    await expect(submitNativeRequest(pending, 'Original text', 'lookup')).rejects.toMatchObject({ status: 502 });
    fetchMock.mockImplementation(async () =>
      Response.json({ ...record, receipt: { ...record.receipt, client_request_id: crypto.randomUUID() } })
    );
    await expect(submitNativeRequest(pending, 'Original text', 'lookup')).rejects.toMatchObject({ status: 502 });
  });
});

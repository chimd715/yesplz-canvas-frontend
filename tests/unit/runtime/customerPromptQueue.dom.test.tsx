import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import { Message } from '@arco-design/web-react';
import {
  useCustomerPromptQueue,
  type QueueExecutionResult,
} from '@/renderer/pages/conversation/platforms/aionrs/PromptQueue';
import {
  getQueue,
  queueScope,
  resetCustomerPromptQueuesForTest,
} from '@/renderer/pages/conversation/platforms/aionrs/PromptQueue/state';
import type { ConversationCommandQueueRuntimeGate } from '@/renderer/pages/conversation/platforms/useConversationCommandQueue';

const { completionListeners } = vi.hoisted(() => ({
  completionListeners: new Set<(event: { session_id: string; turn_id: string }) => void>(),
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      turnCompleted: {
        on: (listener: (event: { session_id: string; turn_id: string }) => void) => {
          completionListeners.add(listener);
          return () => completionListeners.delete(listener);
        },
      },
    },
  },
}));
vi.mock('@arco-design/web-react', () => ({ Message: { warning: vi.fn() } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const idle: ConversationCommandQueueRuntimeGate = { hydrated: true, canSendMessage: true, isProcessing: false };
const busy: ConversationCommandQueueRuntimeGate = { ...idle, canSendMessage: false, isProcessing: true };
const input = (text: string) => ({ input: text, files: [] });
const rejected = () =>
  new BackendHttpError({
    method: 'POST',
    path: '/api/conversations/one/messages',
    status: 400,
    body: { error: 'Invalid attachment' },
  });
const deferred = () => {
  let resolve!: (value: QueueExecutionResult) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<QueueExecutionResult>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

describe('customer prompt FIFO', () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetCustomerPromptQueuesForTest();
    vi.clearAllMocks();
  });

  const setup = (
    gate = busy,
    onExecute = vi.fn().mockResolvedValue({ isProcessing: false }),
    validate = vi.fn().mockReturnValue(true)
  ) => {
    const hook = renderHook(
      ({ accountId, conversationId, runtimeGate }) =>
        useCustomerPromptQueue({ accountId, conversationId, runtimeGate, enabled: true, onExecute, validate }),
      { initialProps: { accountId: 'alice', conversationId: 'one', runtimeGate: gate } }
    );
    return { ...hook, onExecute, validate };
  };

  it('admits three waiting prompts synchronously and rejects the fourth without dropping accepted items', () => {
    const { result } = setup();
    let fourth: unknown;
    act(() => {
      ['first', 'second', 'third'].forEach((text) => result.current.enqueue(input(text)));
      fourth = result.current.enqueue(input('fourth'));
    });
    expect(fourth).toBeNull();
    expect(result.current.items.map((item) => item.input)).toEqual(['first', 'second', 'third']);
    expect(Message.warning).toHaveBeenCalledWith('conversation.customerQueue.full');
  });

  it('excludes the active admission from the three waiting slots', async () => {
    const request = deferred();
    const { result, onExecute } = setup(idle, vi.fn().mockReturnValue(request.promise));
    act(() => {
      result.current.enqueue(input('active'));
    });
    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1));
    act(() => {
      ['one', 'two', 'three'].forEach((text) => result.current.enqueue(input(text)));
    });
    expect(result.current.items).toHaveLength(3);
    expect(result.current.active?.input).toBe('active');
    await act(async () => request.resolve({ turnId: 'active-turn', isProcessing: true }));
    expect(onExecute).toHaveBeenCalledTimes(1);
  });

  it('automatically drains fast completed turns once each in admission order', async () => {
    const { result, rerender, onExecute } = setup();
    act(() => {
      ['first', 'second', 'third'].forEach((text) => result.current.enqueue(input(text)));
    });
    rerender({ accountId: 'alice', conversationId: 'one', runtimeGate: idle });
    await waitFor(() =>
      expect(onExecute.mock.calls.map((call) => call[0].input)).toEqual(['first', 'second', 'third'])
    );
    expect(result.current.items).toEqual([]);
  });

  it('waits for the running turn and for pending question gates instead of interrupting or bypassing them', async () => {
    const { result, rerender, onExecute } = setup();
    act(() => {
      result.current.enqueue(input('first'));
      result.current.enqueue(input('second'));
    });
    rerender({ accountId: 'alice', conversationId: 'one', runtimeGate: { ...idle, canSendMessage: false } });
    expect(onExecute).not.toHaveBeenCalled();
    rerender({ accountId: 'alice', conversationId: 'one', runtimeGate: idle });
    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(2));
  });

  it('does not start the next prompt until an accepted running turn actually finishes', async () => {
    const { result, rerender, onExecute } = setup(
      busy,
      vi.fn().mockResolvedValue({ turnId: 'turn-one', isProcessing: true })
    );
    act(() => {
      result.current.enqueue(input('first'));
      result.current.enqueue(input('second'));
    });
    rerender({ accountId: 'alice', conversationId: 'one', runtimeGate: idle });
    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1));
    rerender({ accountId: 'alice', conversationId: 'one', runtimeGate: busy });
    rerender({ accountId: 'alice', conversationId: 'one', runtimeGate: idle });
    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(2));
  });

  it('handles completion arriving before HTTP acknowledgement without hanging later prompts', async () => {
    const request = deferred();
    const { result, onExecute } = setup(
      idle,
      vi.fn().mockReturnValueOnce(request.promise).mockResolvedValue({ isProcessing: false })
    );
    act(() => {
      result.current.enqueue(input('first'));
      result.current.enqueue(input('second'));
    });
    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1));
    act(() => completionListeners.forEach((listener) => listener({ session_id: 'one', turn_id: 'turn-one' })));
    await act(async () => request.resolve({ turnId: 'turn-one', isProcessing: true }));
    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(2));
  });

  it('revalidates model/context budgets at admission and drain, preserving a rejected head for explicit retry', async () => {
    const { result, rerender, onExecute, validate } = setup();
    act(() => {
      result.current.enqueue(input('first'));
      result.current.enqueue(input('second'));
    });
    validate.mockReturnValue(false);
    rerender({ accountId: 'alice', conversationId: 'one', runtimeGate: idle });
    await waitFor(() => expect(result.current.active?.status).toBe('failed'));
    expect(onExecute).not.toHaveBeenCalled();
    validate.mockReturnValue(true);
    act(() => result.current.retry());
    await waitFor(() => expect(onExecute.mock.calls.map((call) => call[0].input)).toEqual(['first', 'second']));
  });

  it('retains definite API failures and never retries indefinitely or moves later prompts ahead', async () => {
    const { result, rerender, onExecute } = setup(
      busy,
      vi.fn().mockRejectedValueOnce(rejected()).mockResolvedValue({ isProcessing: false })
    );
    act(() => {
      ['first', 'second', 'third'].forEach((text) => result.current.enqueue(input(text)));
    });
    rerender({ accountId: 'alice', conversationId: 'one', runtimeGate: idle });
    await waitFor(() => expect(result.current.active?.status).toBe('failed'));
    expect(onExecute).toHaveBeenCalledTimes(1);
    act(() => {
      result.current.enqueue(input('fourth'));
      result.current.retry();
      result.current.retry();
    });
    await waitFor(() =>
      expect(onExecute.mock.calls.map((call) => call[0].input)).toEqual(['first', 'first', 'second', 'third', 'fourth'])
    );
  });

  it('pauses ambiguous delivery and allows removal without ever automatically resending that prompt', async () => {
    const { result, rerender, onExecute } = setup(
      busy,
      vi.fn().mockRejectedValueOnce(new TypeError('Network failure')).mockResolvedValue({ isProcessing: false })
    );
    act(() => {
      result.current.enqueue(input('uncertain'));
      result.current.enqueue(input('next'));
    });
    rerender({ accountId: 'alice', conversationId: 'one', runtimeGate: idle });
    await waitFor(() => expect(result.current.active?.status).toBe('uncertain'));
    act(() => result.current.retry());
    expect(onExecute).toHaveBeenCalledTimes(1);
    act(() => result.current.remove(result.current.active!.id));
    await waitFor(() => expect(onExecute.mock.calls.map((call) => call[0].input)).toEqual(['uncertain', 'next']));
  });

  it('restores pending files/session references after reload but cannot expose or send another account/conversation queue', async () => {
    const original = setup();
    act(() =>
      original.result.current.enqueue({
        input: 'saved',
        files: [{ kind: 'upload', path: '/upload/id' }],
        sessions: [{ id: 'reference' }],
      })
    );
    original.unmount();
    resetCustomerPromptQueuesForTest();
    const restored = setup();
    expect(restored.result.current.items[0]).toEqual(
      expect.objectContaining({
        input: 'saved',
        sessions: [{ id: 'reference' }],
        files: [{ kind: 'upload', path: '/upload/id' }],
      })
    );
    restored.rerender({ accountId: 'bob', conversationId: 'one', runtimeGate: idle });
    restored.rerender({ accountId: 'alice', conversationId: 'two', runtimeGate: idle });
    expect(restored.result.current.items).toEqual([]);
    expect(restored.onExecute).not.toHaveBeenCalled();
  });

  it('does not auto-send an interrupted admission marker restored by a new page', () => {
    const scope = queueScope('alice', 'one');
    sessionStorage.setItem(
      scope,
      JSON.stringify({
        items: [],
        active: { ...input('maybe accepted'), id: 'first', created_at: 1, status: 'sending' },
      })
    );
    const { result, onExecute } = setup(idle);
    expect(result.current.active?.status).toBe('uncertain');
    expect(onExecute).not.toHaveBeenCalled();
  });

  it('does not dispatch later items after unmount when a request completes', async () => {
    const request = deferred();
    const { result, onExecute, unmount } = setup(idle, vi.fn().mockReturnValue(request.promise));
    act(() => {
      result.current.enqueue(input('first'));
      result.current.enqueue(input('second'));
    });
    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => request.resolve({ isProcessing: false }));
    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(getQueue(queueScope('alice', 'one')).items[0]?.input).toBe('second');
  });

  it('rejects admission if browser storage fails, keeping the prior queue intact', () => {
    const { result } = setup();
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    let accepted: unknown;
    act(() => {
      accepted = result.current.enqueue(input('keep draft'));
    });
    expect(accepted).toBeNull();
    expect(result.current.items).toEqual([]);
    expect(Message.warning).toHaveBeenCalledWith('conversation.customerQueue.storageFailed');
    storage.mockRestore();
  });

  it('waits after a confirmed active-turn conflict instead of spinning or duplicating an accepted item', async () => {
    const conflict = new BackendHttpError({
      method: 'POST',
      path: '/api/conversations/one/messages',
      status: 409,
      body: { code: 'CONFLICT', error: 'conversation one is already running' },
    });
    const { result, rerender, onExecute } = setup(
      idle,
      vi.fn().mockRejectedValueOnce(conflict).mockResolvedValue({ isProcessing: false })
    );
    act(() => result.current.enqueue(input('first')));
    await waitFor(() => expect(result.current.active?.status).toBe('ready'));
    expect(onExecute).toHaveBeenCalledTimes(1);
    rerender({ accountId: 'alice', conversationId: 'one', runtimeGate: busy });
    rerender({ accountId: 'alice', conversationId: 'one', runtimeGate: idle });
    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(2));
    expect(result.current.active).toBeUndefined();
  });

  it('keeps a runtime lifecycle conflict visible for retry rather than waiting indefinitely for a turn', async () => {
    const conflict = new BackendHttpError({
      method: 'POST',
      path: '/api/conversations/one/messages',
      status: 409,
      body: { code: 'CONFLICT', error: 'runtime is shutting down' },
    });
    const { result, onExecute } = setup(idle, vi.fn().mockRejectedValue(conflict));
    act(() => result.current.enqueue(input('first')));
    await waitFor(() => expect(result.current.active?.status).toBe('failed'));
    expect(onExecute).toHaveBeenCalledTimes(1);
  });

  it('removes cancelled waiting items without stopping or duplicating an in-flight admission', async () => {
    const request = deferred();
    const { result, onExecute } = setup(idle, vi.fn().mockReturnValue(request.promise));
    act(() => {
      result.current.enqueue(input('active'));
      result.current.enqueue(input('cancelled'));
    });
    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1));
    act(() => result.current.clear());
    expect(result.current.active?.input).toBe('active');
    await act(async () => request.resolve({ isProcessing: false }));
    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(result.current.items).toEqual([]);
  });

  it('recovers an in-flight admission across remount without dispatching it twice or hanging the next item', async () => {
    const request = deferred();
    const execute = vi.fn().mockReturnValueOnce(request.promise).mockResolvedValue({ isProcessing: false });
    const original = setup(idle, execute);
    act(() => {
      original.result.current.enqueue(input('first'));
      original.result.current.enqueue(input('second'));
    });
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    original.unmount();
    const reopened = setup(idle, execute);
    expect(reopened.result.current.active?.status).toBe('sending');
    await act(async () => request.resolve({ isProcessing: false }));
    await waitFor(() => expect(execute.mock.calls.map((call) => call[0].input)).toEqual(['first', 'second']));
  });

  it('prevents a stale account callback from draining the newly selected account queue', async () => {
    const request = deferred();
    const { result, rerender, onExecute } = setup(
      idle,
      vi.fn().mockReturnValueOnce(request.promise).mockResolvedValue({ isProcessing: false })
    );
    act(() => {
      result.current.enqueue(input('alice-active'));
      result.current.enqueue(input('alice-pending'));
    });
    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1));
    rerender({ accountId: 'bob', conversationId: 'one', runtimeGate: busy });
    act(() => result.current.enqueue(input('bob-pending')));
    await act(async () => request.resolve({ isProcessing: false }));
    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(result.current.items[0]?.input).toBe('bob-pending');
  });
});

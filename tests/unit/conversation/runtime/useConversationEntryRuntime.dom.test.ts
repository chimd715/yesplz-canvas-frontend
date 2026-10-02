import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useConversationEntryRuntime } from '@/renderer/pages/conversation/runtime/useConversationEntryRuntime';

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

describe('conversation entry preparation', () => {
  it('automatically prepares without a customer action and reuses a ready mounted chat', async () => {
    const prepare = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(() => useConversationEntryRuntime('one', prepare));
    await waitFor(() => expect(result.current.isReady).toBe(true));
    rerender();
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('keeps failure visible until retry, then makes the existing chat ready', async () => {
    const prepare = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const { result } = renderHook(() => useConversationEntryRuntime('one', prepare));
    await waitFor(() => expect(result.current.phase).toBe('failed'));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it('reports a synchronous preparation failure rather than breaking the mounted chat', async () => {
    const error = new Error('unavailable');
    const prepare = () => {
      throw error;
    };
    const { result } = renderHook(() => useConversationEntryRuntime('one', prepare));
    await waitFor(() => expect(result.current.phase).toBe('failed'));
    expect(result.current.error).toEqual(new Error('unavailable'));
  });

  it('does not let an old conversation completion unlock a different conversation', async () => {
    const first = deferred();
    const second = deferred();
    const prepareOne = () => first.promise;
    const prepareTwo = () => second.promise;
    const { result, rerender } = renderHook(({ id, prepare }) => useConversationEntryRuntime(id, prepare), {
      initialProps: { id: 'one', prepare: prepareOne },
    });
    rerender({ id: 'two', prepare: prepareTwo });
    await act(async () => first.resolve());
    expect(result.current.isReady).toBe(false);
    await act(async () => second.resolve());
    expect(result.current.isReady).toBe(true);
  });

  it('does not publish an old conversation failure in the newly opened chat', async () => {
    const first = deferred();
    const prepareOne = () => first.promise;
    const prepareTwo = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ id, prepare }) => useConversationEntryRuntime(id, prepare), {
      initialProps: { id: 'one', prepare: prepareOne },
    });
    rerender({ id: 'two', prepare: prepareTwo });
    await waitFor(() => expect(result.current.isReady).toBe(true));
    await act(async () => first.reject(new Error('offline')));
    expect(result.current.error).toBeUndefined();
    expect(result.current.phase).toBe('ready');
  });

  it('prepares again when reopening after unmount and never requires a resume action', async () => {
    const prepare = vi.fn().mockResolvedValue(undefined);
    const first = renderHook(() => useConversationEntryRuntime('one', prepare));
    await waitFor(() => expect(first.result.current.isReady).toBe(true));
    first.unmount();
    const reopened = renderHook(() => useConversationEntryRuntime('one', prepare));
    await waitFor(() => expect(reopened.result.current.isReady).toBe(true));
    expect(prepare).toHaveBeenCalledTimes(2);
  });
});

import { useCallback, useEffect, useState } from 'react';

type EntryRuntimeState = {
  conversationId: string;
  prepare: () => Promise<void>;
  phase: 'preparing' | 'ready' | 'failed';
  error?: unknown;
};

/** Prepare an existing chat without replacing its history or sending a turn. */
export function useConversationEntryRuntime(conversationId: string, prepare: () => Promise<void>) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<EntryRuntimeState>();
  const current = state?.conversationId === conversationId && state.prepare === prepare ? state : undefined;
  const phase = current?.phase ?? 'preparing';

  useEffect(() => {
    let cancelled = false;
    setState({ conversationId, prepare, phase: 'preparing' });
    void Promise.resolve()
      .then(prepare)
      .then(
        () => {
          if (!cancelled) setState({ conversationId, prepare, phase: 'ready' });
        },
        (error: unknown) => {
          if (!cancelled) setState({ conversationId, prepare, phase: 'failed', error });
        }
      );
    return () => {
      cancelled = true;
    };
  }, [conversationId, prepare, attempt]);

  const retry = useCallback(() => {
    if (phase === 'failed') setAttempt((previous) => previous + 1);
  }, [phase]);

  return { phase, isReady: phase === 'ready', error: current?.error, retry };
}

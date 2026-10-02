import { ipcBridge } from '@/common';
import { uuid } from '@/common/utils';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import { Message } from '@arco-design/web-react';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { classifyConversationBusyError } from '../../conversationBusyError';
import type {
  ConversationCommandQueueItem,
  ConversationCommandQueueRuntimeGate,
} from '../../useConversationCommandQueue';
import { EMPTY_QUEUE, getQueue, inFlight, MAX_PENDING_PROMPTS, queueScope, saveQueue, subscribeQueue } from './state';

export type QueueExecutionResult = { turnId?: string; isProcessing?: boolean } | void;
export class PromptQueueAdmissionError extends Error {}
type Options = {
  accountId?: string;
  conversationId: string;
  enabled: boolean;
  runtimeGate: ConversationCommandQueueRuntimeGate;
  validate: (input: string, attachmentCount: number) => boolean;
  onExecute: (item: ConversationCommandQueueItem) => Promise<QueueExecutionResult>;
};

/** Browser FIFO. It runs only while its authorized conversation is mounted. */
export const useCustomerPromptQueue = ({
  accountId,
  conversationId,
  enabled,
  runtimeGate,
  validate,
  onExecute,
}: Options) => {
  const { t } = useTranslation();
  const scope = enabled && accountId ? queueScope(accountId, conversationId) : '';
  const getSnapshot = useCallback(() => (scope ? getQueue(scope) : EMPTY_QUEUE), [scope]);
  const state = useSyncExternalStore(subscribeQueue, getSnapshot, getSnapshot);
  const latest = useRef({ scope, runtimeGate, validate, onExecute });
  latest.current = { scope, runtimeGate, validate, onExecute };
  const awaiting = useRef<{ scope: string; turnId?: string; busySeen: boolean } | null>(null);
  const completedTurns = useRef(new Set<string>());
  const mountedScope = useRef('');

  const persist = useCallback(
    (next: typeof state, accepted = false) => {
      if (saveQueue(scope, next, accepted)) return true;
      Message.warning(t('conversation.customerQueue.storageFailed'));
      return false;
    },
    [scope, t]
  );

  useEffect(() => {
    mountedScope.current = scope;
    awaiting.current = null;
    completedTurns.current.clear();
    if (!scope) return;
    const unsubscribe = ipcBridge.conversation.turnCompleted.on((event) => {
      if (event.session_id !== conversationId || latest.current.scope !== scope) return;
      completedTurns.current.add(event.turn_id);
      if (
        awaiting.current?.scope === scope &&
        (!awaiting.current.turnId || awaiting.current.turnId === event.turn_id)
      ) {
        awaiting.current = null;
        // Notify even if queue content did not change: the execution gate can
        // already be idle when a very fast turn's completion arrives.
        saveQueue(scope, { ...getQueue(scope) }, true);
      }
    });
    return () => {
      mountedScope.current = '';
      unsubscribe();
    };
  }, [scope, conversationId]);

  const enqueue = useCallback(
    (item: Pick<ConversationCommandQueueItem, 'input' | 'files' | 'sessions'>) => {
      if (!scope || !item.input.trim() || !validate(item.input, item.files.length)) return null;
      const current = getQueue(scope);
      if (current.items.length >= MAX_PENDING_PROMPTS) {
        Message.warning(t('conversation.customerQueue.full'));
        return null;
      }
      const queued = { ...item, id: uuid(), created_at: Date.now() };
      return persist({ ...current, items: [...current.items, queued] }) ? queued : null;
    },
    [scope, validate, persist, t]
  );

  const remove = useCallback(
    (id: string) => {
      if (!scope) return false;
      const current = getQueue(scope);
      if (current.active?.id === id && inFlight.has(scope)) return false;
      return persist({
        active: current.active?.id === id ? undefined : current.active,
        items: current.items.filter((item) => item.id !== id),
      });
    },
    [scope, persist]
  );

  const retry = useCallback(() => {
    if (!scope || inFlight.has(scope)) return;
    const current = getQueue(scope);
    if (current.active?.status !== 'failed') return;
    // Retry the failed head without changing FIFO order or consuming another slot.
    persist({ ...current, active: { ...current.active, status: 'ready' } });
  }, [scope, persist]);

  const clear = useCallback(() => {
    if (!scope) return;
    const current = getQueue(scope);
    persist({ items: [], active: inFlight.has(scope) ? current.active : undefined });
  }, [scope, persist]);

  const resetActiveExecution = useCallback(() => {
    awaiting.current = null;
    if (scope) saveQueue(scope, { ...getQueue(scope) }, true);
  }, [scope]);

  useEffect(() => {
    if (!scope || mountedScope.current !== scope) return;
    const wait = awaiting.current;
    if (wait?.scope === scope) {
      if (runtimeGate.isProcessing || !runtimeGate.canSendMessage) wait.busySeen = true;
      if (wait.busySeen && runtimeGate.hydrated && runtimeGate.canSendMessage && !runtimeGate.isProcessing)
        awaiting.current = null;
      else return;
    }
    if (!runtimeGate.hydrated || !runtimeGate.canSendMessage || runtimeGate.isProcessing || inFlight.has(scope)) return;
    const current = getQueue(scope);
    if (current.active && current.active.status !== 'ready') return;
    const item = current.active ?? current.items[0];
    if (!item) return;
    const remaining = current.active ? current.items : current.items.slice(1);
    // Move the sending item into the separate active slot. The capacity of
    // three counts waiting prompts, so the current admission/turn is excluded.
    inFlight.add(scope);
    if (!persist({ active: { ...item, status: 'sending' }, items: remaining })) {
      inFlight.delete(scope);
      return;
    }
    void (async () => {
      let attempted = false;
      try {
        if (mountedScope.current !== scope || latest.current.scope !== scope) {
          saveQueue(scope, { active: { ...item, status: 'failed' }, items: getQueue(scope).items }, true);
          return;
        }
        if (!latest.current.validate(item.input, item.files.length)) throw new Error('Prompt budget exceeded');
        attempted = true;
        const result = (await latest.current.onExecute(item)) || {};
        const now = getQueue(scope);
        if (
          mountedScope.current === scope &&
          latest.current.scope === scope &&
          result?.isProcessing !== false &&
          !completedTurns.current.has(result?.turnId ?? '')
        ) {
          awaiting.current = { scope, turnId: result?.turnId, busySeen: latest.current.runtimeGate.isProcessing };
        }
        persist({ items: now.items }, true);
      } catch (error) {
        const now = getQueue(scope);
        const busy = classifyConversationBusyError(error);
        // A confirmed 409 cannot have accepted this item. Wait for the running
        // turn before trying it again; ordinary failures require explicit retry.
        if (busy?.kind === 'active_turn' && mountedScope.current === scope && latest.current.scope === scope) {
          awaiting.current = {
            scope,
            busySeen: latest.current.runtimeGate.isProcessing || !latest.current.runtimeGate.canSendMessage,
          };
          persist({ active: { ...item, status: 'ready' }, items: now.items }, true);
        } else {
          const definiteRejection =
            !attempted ||
            error instanceof PromptQueueAdmissionError ||
            (error instanceof BackendHttpError && error.status >= 400 && error.status < 500);
          persist({ active: { ...item, status: definiteRejection ? 'failed' : 'uncertain' }, items: now.items }, true);
        }
      } finally {
        inFlight.delete(scope);
        // A remounted composer for the same scope may be waiting for this
        // admission. Notify it after releasing the shared lock, even if the
        // original composer has left; unmounted scopes have no runner.
        saveQueue(scope, { ...getQueue(scope) }, true);
      }
    })();
  }, [scope, state, runtimeGate.hydrated, runtimeGate.canSendMessage, runtimeGate.isProcessing, persist]);

  return {
    ...state,
    enqueue,
    remove,
    retry,
    clear,
    resetActiveExecution,
    hasPendingCommands: Boolean(state.active || state.items.length),
    isFull: state.items.length >= MAX_PENDING_PROMPTS,
  };
};

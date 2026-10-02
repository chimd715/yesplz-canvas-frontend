import { isChatFileRef } from '@/common/types/chatFile';
import type { ConversationCommandQueueItem } from '../../useConversationCommandQueue';

export const MAX_PENDING_PROMPTS = 3;
export const CUSTOMER_QUEUE_PREFIX = 'customer-prompt-queue/';
export type ActivePrompt = ConversationCommandQueueItem & { status: 'ready' | 'sending' | 'failed' | 'uncertain' };
export type PromptQueueState = { items: ConversationCommandQueueItem[]; active?: ActivePrompt };
export const EMPTY_QUEUE: PromptQueueState = { items: [] };
const states = new Map<string, PromptQueueState>();
const listeners = new Set<() => void>();
export const inFlight = new Set<string>();

export const queueScope = (accountId: string, conversationId: string): string =>
  `${CUSTOMER_QUEUE_PREFIX}${encodeURIComponent(accountId)}/${encodeURIComponent(conversationId)}`;

const validItem = (value: unknown): value is ConversationCommandQueueItem => {
  if (!value || typeof value !== 'object') return false;
  const item = value as ConversationCommandQueueItem;
  return (
    typeof item.id === 'string' &&
    typeof item.input === 'string' &&
    item.input.trim().length > 0 &&
    Array.isArray(item.files) &&
    item.files.every(isChatFileRef) &&
    typeof item.created_at === 'number' &&
    Number.isFinite(item.created_at) &&
    (item.sessions === undefined ||
      (Array.isArray(item.sessions) && item.sessions.every((session) => typeof session?.id === 'string')))
  );
};

export const getQueue = (scope: string): PromptQueueState => {
  if (!scope) return EMPTY_QUEUE;
  const existing = states.get(scope);
  if (existing) return existing;
  let state = EMPTY_QUEUE;
  try {
    const value = JSON.parse(sessionStorage.getItem(scope) ?? 'null') as PromptQueueState | null;
    if (value && Array.isArray(value.items)) {
      const ids = new Set<string>();
      const items = value.items
        .filter((item) => {
          if (!validItem(item) || ids.has(item.id)) return false;
          ids.add(item.id);
          return true;
        })
        .slice(0, MAX_PENDING_PROMPTS);
      const active = validItem(value.active)
        ? {
            ...value.active,
            status:
              value.active.status === 'ready'
                ? ('ready' as const)
                : value.active.status === 'failed'
                  ? ('failed' as const)
                  : ('uncertain' as const),
          }
        : undefined;
      state = { items: active ? items.filter((item) => item.id !== active.id) : items, active };
    }
  } catch {
    // Broken or unavailable storage cannot authorize sending an unknown item.
  }
  states.set(scope, state);
  return state;
};

/** Persist before acknowledging admission. Accepted network sends may update
 * memory despite a later storage failure; their stored sending marker prevents
 * an automatic duplicate after reload. */
export const saveQueue = (scope: string, state: PromptQueueState, accepted = false): boolean => {
  let persisted = true;
  try {
    if (!state.active && state.items.length === 0) sessionStorage.removeItem(scope);
    else sessionStorage.setItem(scope, JSON.stringify(state));
  } catch {
    persisted = false;
  }
  if (persisted || accepted) {
    states.set(scope, state);
    listeners.forEach((listener) => listener());
  }
  return persisted;
};

export const subscribeQueue = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const resetCustomerPromptQueuesForTest = (): void => {
  states.clear();
  inFlight.clear();
};

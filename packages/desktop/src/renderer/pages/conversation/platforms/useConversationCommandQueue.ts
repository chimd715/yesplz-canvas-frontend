import { ipcBridge } from '@/common';
import type { SessionRef } from '@/common/adapter/ipcBridge';
import { type ChatFileRef, chatFileRefKey, isChatFileRef } from '@/common/types/chatFile';
import { uuid } from '@/common/utils';
import {
  getConversationRuntimeViewSnapshot,
  turnCompleted,
} from '@/renderer/pages/conversation/runtime/conversationRuntimeViewStore';
import { useAddEventListener } from '@/renderer/utils/emitter';
import { Message } from '@arco-design/web-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR, { useSWRConfig, type Cache } from 'swr';
import { classifyConversationBusyError } from './conversationBusyError';
import { pendingRequestSchema, type PendingNativeRequest } from './aionrs/durableAdmission';

export type ConversationCommandQueueItem = {
  id: string;
  input: string;
  files: ChatFileRef[];
  /** `@@` session references. Must survive the draft box: a message that goes
   *  through the queue and loses its references is a silent failure — the agent
   *  simply never sees the session block. Ids only, so this adds a handful of
   *  bytes to the persisted state. */
  sessions?: SessionRef[];
  created_at: number;
  request?: PendingNativeRequest;
  pending?: boolean;
  recorded?: boolean;
};

export type ConversationCommandQueueMode = 'auto' | 'manual';

export type ConversationCommandQueueState = {
  items: ConversationCommandQueueItem[];
  isPaused: boolean;
  mode: ConversationCommandQueueMode;
};

export const MAX_QUEUED_COMMANDS = 20;
export const MAX_QUEUED_COMMAND_INPUT_LENGTH = 20_000;
export const MAX_QUEUED_COMMAND_FILES = 50;
export const MAX_QUEUED_COMMAND_STATE_BYTES = 256 * 1024;

export type QueueValidationFailureReason =
  | 'emptyInput'
  | 'inputTooLong'
  | 'tooManyFiles'
  | 'queueFull'
  | 'queueTooLarge';

type QueueValidationSuccess = {
  ok: true;
  nextStateBytes: number;
};

type QueueValidationFailure = {
  ok: false;
  reason: QueueValidationFailureReason;
};

const COMMAND_QUEUE_LOG_PREFIX = '[conversation-command-queue]';

/** Keep only well-formed `{ id }` refs from persisted state. Unknown shapes are
 *  dropped rather than failing the whole item: losing a stale reference is
 *  recoverable, losing the user's typed message is not. */
const normalizeSessionRefs = (value: unknown): SessionRef[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const refs = value.filter(
    (entry): entry is SessionRef =>
      typeof (entry as SessionRef | undefined)?.id === 'string' && (entry as SessionRef).id.length > 0
  );
  return refs.length > 0 ? refs : undefined;
};

const summarizeQueuedCommand = (item: ConversationCommandQueueItem): Record<string, unknown> => ({
  id: item.id,
  created_at: item.created_at,
  inputLength: item.input.length,
  fileCount: item.files.length,
  // Count only, matching `fileCount` — never the referenced ids or names.
  sessionCount: item.sessions?.length ?? 0,
});

const logCommandQueue = (conversation_id: string, event: string, payload: Record<string, unknown> = {}): void => {
  console.info(COMMAND_QUEUE_LOG_PREFIX, {
    conversation_id,
    event,
    ...payload,
  });
  void ipcBridge.application?.writeRendererLog
    ?.invoke({
      level: 'info',
      tag: 'conversationCommandQueue',
      message: event,
      data: {
        conversation_id,
        ...payload,
      },
    })
    .catch(() => {});
};

const normalizeQueueMode = (mode: unknown): ConversationCommandQueueMode => (mode === 'auto' ? 'auto' : 'manual');

const createDefaultQueueState = (): ConversationCommandQueueState => ({
  items: [],
  isPaused: false,
  mode: 'manual',
});

const queueStore = new Map<string, ConversationCommandQueueState>();
let queueEpoch = 0;
const requestCaches = new Set<Cache>();
export const commandQueueAuthEpoch = (): number => queueEpoch;

export const clearScopedCommandQueues = (): void => {
  queueEpoch++;
  for (const cache of requestCaches)
    for (const key of cache.keys()) {
      if (key.includes('/conversation-command-queue/scoped/') || key.includes('native-admission')) cache.delete(key);
    }
  for (const key of queueStore.keys()) if (key.startsWith('scoped/')) queueStore.delete(key);
  try {
    for (const key of Object.keys(sessionStorage))
      if (key.startsWith('conversation-command-queue/scoped/')) sessionStorage.removeItem(key);
  } catch {
    console.warn('[conversation-command-queue] Browser storage unavailable during logout');
  }
};

const getStorageKey = (conversation_id: string): string => `conversation-command-queue/${conversation_id}`;
const measureQueueStateBytes = (state: ConversationCommandQueueState): number =>
  new TextEncoder().encode(JSON.stringify(state)).length;

/** Dedup refs by their identity key, preserving first-seen order. */
const uniqueFiles = (files: ChatFileRef[]): ChatFileRef[] => {
  const seen = new Set<string>();
  const result: ChatFileRef[] = [];
  for (const ref of files) {
    const key = chatFileRefKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result;
};
const isInputEmpty = (input: string): boolean => input.trim().length === 0;

const normalizeQueueItem = (item: unknown): ConversationCommandQueueItem | null => {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const candidate = item as Record<string, unknown>;
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.input !== 'string' ||
    !Array.isArray(candidate.files) ||
    !candidate.files.every(isChatFileRef) ||
    typeof candidate.created_at !== 'number' ||
    !Number.isFinite(candidate.created_at)
  ) {
    return null;
  }

  const normalizedItem: ConversationCommandQueueItem = {
    id: candidate.id,
    input: candidate.input,
    // Elements validated by the isChatFileRef guard above; `.every` doesn't
    // narrow the array element type, so assert it here.
    files: uniqueFiles(candidate.files as ChatFileRef[]),
    // Absent in state persisted before `@@` existed, so this must tolerate
    // `undefined` rather than rejecting the whole item.
    sessions: normalizeSessionRefs(candidate.sessions),
    created_at: candidate.created_at,
    ...(pendingRequestSchema.safeParse(candidate.request).success
      ? {
          request: pendingRequestSchema.parse(candidate.request),
          pending: candidate.pending === true,
          recorded: candidate.recorded === true,
        }
      : // Preserve uncertain text, but never downgrade invalid metadata to a legacy send.
        candidate.request || candidate.pending
        ? { pending: true }
        : {}),
  };

  if (
    isInputEmpty(normalizedItem.input) ||
    normalizedItem.input.length > MAX_QUEUED_COMMAND_INPUT_LENGTH ||
    normalizedItem.files.length > MAX_QUEUED_COMMAND_FILES
  ) {
    return null;
  }

  return normalizedItem;
};

export const normalizeQueueState = (state: unknown): ConversationCommandQueueState => {
  if (!state || typeof state !== 'object') {
    return createDefaultQueueState();
  }

  const candidate = state as Partial<ConversationCommandQueueState>;
  const mode = normalizeQueueMode(candidate.mode);
  const normalizedItems = Array.isArray(candidate.items)
    ? candidate.items.map(normalizeQueueItem).filter((item): item is ConversationCommandQueueItem => item !== null)
    : [];
  const items: ConversationCommandQueueItem[] = [];

  for (const item of normalizedItems.slice(0, MAX_QUEUED_COMMANDS)) {
    const nextItems = [...items, item];
    const nextState = {
      items: nextItems,
      isPaused: Boolean(candidate.isPaused),
      mode,
    };

    if (measureQueueStateBytes(nextState) > MAX_QUEUED_COMMAND_STATE_BYTES) {
      break;
    }

    items.push(item);
  }

  return {
    items,
    isPaused: items.length > 0 ? Boolean(candidate.isPaused) : false,
    mode,
  };
};

export const estimateQueueStateBytes = (state: ConversationCommandQueueState): number =>
  measureQueueStateBytes(normalizeQueueState(state));

export const createQueuedCommandItem = ({
  input,
  files,
  sessions,
}: Pick<ConversationCommandQueueItem, 'input' | 'files' | 'sessions'>): ConversationCommandQueueItem => ({
  id: uuid(),
  input,
  files: uniqueFiles(files),
  // Normalised on the way in as well as on the way out of persistence, so an
  // empty array never survives as `[]` and the state stays comparable.
  sessions: normalizeSessionRefs(sessions),
  created_at: Date.now(),
});

const getQueueValidationFailureReason = (state: ConversationCommandQueueState): QueueValidationFailureReason | null => {
  if (state.items.length > MAX_QUEUED_COMMANDS) {
    return 'queueFull';
  }

  if (state.items.some((item) => isInputEmpty(item.input))) {
    return 'emptyInput';
  }

  if (state.items.some((item) => item.input.length > MAX_QUEUED_COMMAND_INPUT_LENGTH)) {
    return 'inputTooLong';
  }

  if (state.items.some((item) => item.files.length > MAX_QUEUED_COMMAND_FILES)) {
    return 'tooManyFiles';
  }

  if (measureQueueStateBytes(state) > MAX_QUEUED_COMMAND_STATE_BYTES) {
    return 'queueTooLarge';
  }

  return null;
};

export const validateQueuedCommandItem = (
  item: ConversationCommandQueueItem,
  state: ConversationCommandQueueState
): QueueValidationSuccess | QueueValidationFailure => {
  const nextState = {
    ...state,
    items: [...state.items, item],
  };
  const failureReason = getQueueValidationFailureReason(nextState);
  if (failureReason) {
    return { ok: false, reason: failureReason };
  }
  const nextStateBytes = measureQueueStateBytes(nextState);
  return { ok: true, nextStateBytes };
};

const isQueueValidationFailure = (
  validation: QueueValidationSuccess | QueueValidationFailure
): validation is QueueValidationFailure => !validation.ok;

const readPersistedQueueState = (conversation_id: string): ConversationCommandQueueState => {
  if (queueStore.has(conversation_id)) {
    return queueStore.get(conversation_id) ?? createDefaultQueueState();
  }

  if (typeof window === 'undefined') {
    return createDefaultQueueState();
  }

  try {
    const stored = window.sessionStorage.getItem(getStorageKey(conversation_id));
    if (!stored) {
      return createDefaultQueueState();
    }

    const parsed = JSON.parse(stored) as unknown;
    const normalized = normalizeQueueState(parsed);
    queueStore.set(conversation_id, normalized);
    logCommandQueue(conversation_id, 'restored', {
      itemCount: normalized.items.length,
      isPaused: normalized.isPaused,
    });
    return normalized;
  } catch (error) {
    console.warn('[conversation-command-queue] Failed to read persisted queue state:', error);
    return createDefaultQueueState();
  }
};

export const hasRetainedCommandRequests = (scope: string, conversationId: string): boolean =>
  readPersistedQueueState(`scoped/${scope}/${conversationId}`).items.some((item) => !!item.request || item.pending);

/** Read original owner/project-scoped intents across continuations without moving or rewriting them. */
export const getRetainedLogicalRequests = (scope: string, logicalId: string): ConversationCommandQueueItem[] => {
  const prefix = `scoped/${scope}/`;
  const keys = new Set([...queueStore.keys()].filter((key) => key.startsWith(prefix)));
  try {
    for (const key of Object.keys(sessionStorage))
      if (key.startsWith(`conversation-command-queue/${prefix}`))
        keys.add(key.slice('conversation-command-queue/'.length));
  } catch {
    /* unavailable browser storage leaves existing in-memory intents visible */
  }
  return [...keys].flatMap((key) => {
    let state = queueStore.get(key);
    if (!state) {
      try {
        state = normalizeQueueState(JSON.parse(sessionStorage.getItem(getStorageKey(key)) ?? '{}'));
      } catch {
        return [];
      }
    }
    return state.items
      .filter(
        (item) => (item.pending || !!item.request) && (!item.request || item.request.context.logicalId === logicalId)
      )
      .map((item) => structuredClone(item));
  });
};

const removePersistedQueueState = (conversation_id: string): void => {
  queueStore.delete(conversation_id);
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.removeItem(getStorageKey(conversation_id));
    } catch (error) {
      console.warn('[conversation-command-queue] Failed to remove persisted queue state:', error);
    }
  }
};

const persistQueueState = (conversation_id: string, state: ConversationCommandQueueState, required = false): void => {
  const normalized = normalizeQueueState(state);

  if (normalized.items.length === 0 && !normalized.isPaused && normalized.mode === 'manual') {
    removePersistedQueueState(conversation_id);
    return;
  }

  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.setItem(getStorageKey(conversation_id), JSON.stringify(normalized));
    } catch (error) {
      if (required) throw error;
      console.warn('[conversation-command-queue] Failed to persist queue state:', error);
    }
  } else if (required) throw new Error('Request storage unavailable');
  queueStore.set(conversation_id, normalized);
};

export const removeQueuedCommand = (
  items: ConversationCommandQueueItem[],
  commandId: string
): ConversationCommandQueueItem[] => items.filter((item) => item.id !== commandId);

export const reorderQueuedCommand = (
  items: ConversationCommandQueueItem[],
  activeCommandId: string,
  overCommandId: string
): ConversationCommandQueueItem[] => {
  const fromIndex = items.findIndex((item) => item.id === activeCommandId);
  const targetIndex = items.findIndex((item) => item.id === overCommandId);

  if (fromIndex === -1 || targetIndex === -1 || fromIndex === targetIndex) {
    return items;
  }

  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);
  nextItems.splice(targetIndex, 0, movedItem);
  return nextItems;
};

export const restoreQueuedCommand = (
  items: ConversationCommandQueueItem[],
  failedItem: ConversationCommandQueueItem
): ConversationCommandQueueItem[] => [failedItem, ...removeQueuedCommand(items, failedItem.id)];

export const updateQueuedCommand = (
  items: ConversationCommandQueueItem[],
  commandId: string,
  updates: Partial<Pick<ConversationCommandQueueItem, 'input' | 'files' | 'sessions'>>
): ConversationCommandQueueItem[] =>
  items.map((item) =>
    item.id === commandId
      ? {
          ...item,
          ...updates,
          files: updates.files ? uniqueFiles(updates.files) : item.files,
          sessions: updates.sessions ?? item.sessions,
        }
      : item
  );

export const shouldEnqueueConversationCommand = ({
  enabled = true,
  isBusy,
  hasPendingCommands,
}: {
  enabled?: boolean;
  isBusy: boolean;
  hasPendingCommands: boolean;
}): boolean => enabled && (isBusy || hasPendingCommands);

export type ConversationCommandQueueRuntimeGate = {
  hydrated: boolean;
  canSendMessage: boolean;
  isProcessing: boolean;
};

export type CommandQueueExecutionGate = {
  hydrated: boolean;
  canExecute: boolean;
  isProcessing: boolean;
};

export const getCommandQueueExecutionGate = ({
  isBusy,
  isHydrated = true,
  runtimeGate,
}: {
  isBusy: boolean;
  isHydrated?: boolean;
  runtimeGate?: ConversationCommandQueueRuntimeGate;
}): CommandQueueExecutionGate => {
  if (runtimeGate) {
    return {
      hydrated: runtimeGate.hydrated,
      canExecute: runtimeGate.canSendMessage && !runtimeGate.isProcessing,
      isProcessing: runtimeGate.isProcessing,
    };
  }

  return {
    hydrated: isHydrated,
    canExecute: !isBusy,
    isProcessing: isBusy,
  };
};

type UseConversationCommandQueueOptions = {
  conversation_id: string;
  enabled?: boolean;
  isBusy: boolean;
  isHydrated?: boolean;
  runtimeGate?: ConversationCommandQueueRuntimeGate;
  onExecute: (
    item: ConversationCommandQueueItem,
    action?: 'send' | 'lookup' | 'reconcile'
  ) => Promise<void | false | 'recorded'>;
  storageScope?: string;
  retainUntilAccepted?: boolean;
  prepareItem?: (item: ConversationCommandQueueItem) => ConversationCommandQueueItem;
  preserveWhenDisabled?: boolean;
};

/// `sessions` is part of the enqueue input, not just of the stored item: a
/// message that reaches the draft box and loses its `@@` references fails
/// silently — the send succeeds and the agent simply never sees the block.
type EnqueueCommandInput = Pick<ConversationCommandQueueItem, 'input' | 'files' | 'sessions'>;
type UpdateCommandInput = Pick<ConversationCommandQueueItem, 'input'>;
type BackgroundCommandQueueRunner = {
  conversation_id: string;
  active: boolean;
  executing: boolean;
  onExecute: (item: ConversationCommandQueueItem) => Promise<void>;
};

const backgroundRunners = new Map<string, BackgroundCommandQueueRunner>();
let backgroundTurnCompletedUnsubscribe: (() => void) | null = null;

const ensureBackgroundTurnCompletedListener = (): void => {
  if (backgroundTurnCompletedUnsubscribe) {
    return;
  }

  backgroundTurnCompletedUnsubscribe = ipcBridge.conversation.turnCompleted.on((event) => {
    const runner = backgroundRunners.get(event.session_id);
    if (!runner || runner.active) {
      return;
    }

    turnCompleted(event.session_id, event.turn_id, event.runtime);
    void drainBackgroundCommandQueue(runner);
  });
};

const releaseBackgroundTurnCompletedListener = (): void => {
  if (backgroundRunners.size > 0) {
    return;
  }

  backgroundTurnCompletedUnsubscribe?.();
  backgroundTurnCompletedUnsubscribe = null;
};

const registerBackgroundCommandQueueRunner = (
  runner: Omit<BackgroundCommandQueueRunner, 'active' | 'executing'>
): void => {
  const existing = backgroundRunners.get(runner.conversation_id);
  backgroundRunners.set(runner.conversation_id, {
    ...runner,
    active: true,
    executing: existing?.executing ?? false,
  });
  ensureBackgroundTurnCompletedListener();
};

const detachBackgroundCommandQueueRunner = (conversation_id: string): void => {
  const runner = backgroundRunners.get(conversation_id);
  if (!runner) {
    return;
  }

  const state = readPersistedQueueState(conversation_id);
  if (state.items.length === 0 || state.isPaused || state.mode === 'manual') {
    backgroundRunners.delete(conversation_id);
    releaseBackgroundTurnCompletedListener();
    return;
  }

  runner.active = false;
  void drainBackgroundCommandQueue(runner);
};

const drainBackgroundCommandQueue = async (runner: BackgroundCommandQueueRunner): Promise<void> => {
  if (runner.active || runner.executing) {
    return;
  }

  const runtimeView = getConversationRuntimeViewSnapshot(runner.conversation_id);
  const state = readPersistedQueueState(runner.conversation_id);
  if (state.items.length === 0) {
    backgroundRunners.delete(runner.conversation_id);
    releaseBackgroundTurnCompletedListener();
    return;
  }

  if (state.isPaused || state.mode === 'manual') {
    return;
  }

  if (!runtimeView.hydrated || !runtimeView.canSendMessage || runtimeView.isProcessing) {
    return;
  }

  const currentState = readPersistedQueueState(runner.conversation_id);
  const [nextCommand, ...remainingCommands] = currentState.items;
  if (!nextCommand) {
    backgroundRunners.delete(runner.conversation_id);
    releaseBackgroundTurnCompletedListener();
    return;
  }

  runner.executing = true;
  let shouldContinueDrain = true;
  logCommandQueue(runner.conversation_id, 'background-dequeued', {
    item: summarizeQueuedCommand(nextCommand),
    remainingItemCount: remainingCommands.length,
  });
  persistQueueState(runner.conversation_id, {
    ...currentState,
    items: remainingCommands,
    isPaused: false,
  });

  try {
    await runner.onExecute(nextCommand);
  } catch (error) {
    const failedState = readPersistedQueueState(runner.conversation_id);
    const restoredItems = restoreQueuedCommand(failedState.items, nextCommand);
    const busyError = classifyConversationBusyError(error);
    if (busyError) {
      logCommandQueue(runner.conversation_id, 'background-busy-wait', {
        item: summarizeQueuedCommand(nextCommand),
        busyKind: busyError.kind,
        status: busyError.status,
        code: busyError.code,
        remainingItemCount: restoredItems.length,
      });
      persistQueueState(runner.conversation_id, { ...failedState, items: restoredItems, isPaused: false });
      shouldContinueDrain = false;
      return;
    }
    console.error('[conversation-command-queue] Failed to execute background queued command:', error);
    logCommandQueue(runner.conversation_id, 'background-execute-failed', {
      item: summarizeQueuedCommand(nextCommand),
      error: error instanceof Error ? error.message : String(error),
    });
    persistQueueState(runner.conversation_id, { ...failedState, items: restoredItems, isPaused: true });
    Message.warning('The next queued command could not start. Edit, reorder, or remove it to continue.');
  } finally {
    runner.executing = false;
    if (shouldContinueDrain) {
      void drainBackgroundCommandQueue(runner);
    }
  }
};

export const resetConversationCommandQueueBackgroundRunnerForTest = (): void => {
  backgroundRunners.clear();
  backgroundTurnCompletedUnsubscribe?.();
  backgroundTurnCompletedUnsubscribe = null;
};

const getQueueValidationMessage = (
  t: (key: string, options?: Record<string, unknown>) => string,
  reason: QueueValidationFailureReason
): string => {
  const warningKeyMap = {
    emptyInput: 'conversation.commandQueue.emptyInput',
    queueFull: 'conversation.commandQueue.queueFull',
    inputTooLong: 'conversation.commandQueue.inputTooLong',
    tooManyFiles: 'conversation.commandQueue.tooManyFiles',
    queueTooLarge: 'conversation.commandQueue.queueTooLarge',
  } as const;
  const defaultValueMap = {
    emptyInput: 'Queued commands cannot be empty.',
    queueFull: 'Queue is full. Remove a command before adding more.',
    inputTooLong: 'This queued command is too long. Shorten it before sending.',
    tooManyFiles: 'Too many files are attached to this queued command.',
    queueTooLarge: 'Queue data is too large to persist safely. Remove some queued commands first.',
  } as const;

  return t(warningKeyMap[reason], {
    count: MAX_QUEUED_COMMANDS,
    files: MAX_QUEUED_COMMAND_FILES,
    defaultValue: defaultValueMap[reason],
  });
};

export const useConversationCommandQueue = ({
  conversation_id,
  enabled = true,
  isBusy,
  isHydrated = true,
  runtimeGate,
  onExecute,
  storageScope,
  retainUntilAccepted = false,
  prepareItem,
  preserveWhenDisabled = false,
}: UseConversationCommandQueueOptions) => {
  const { t } = useTranslation();
  const queueKey = storageScope ? `scoped/${storageScope}/${conversation_id}` : conversation_id;
  const epoch = queueEpoch;
  const { cache } = useSWRConfig();
  if (storageScope) requestCaches.add(cache);
  const retainedExecuting = useRef(false);
  const restoredQueue = useRef<string | null>(null);
  const executionGate = getCommandQueueExecutionGate({ isBusy, isHydrated, runtimeGate });
  const { data = createDefaultQueueState(), mutate } = useSWR(
    [`/conversation-command-queue/${queueKey}`, queueKey, enabled, storageScope ? epoch : 0],
    ([, id, is_enabled]) => (is_enabled ? readPersistedQueueState(id) : createDefaultQueueState())
  );

  const stateRef = useRef(data);
  const pausedRef = useRef(data.isPaused);
  const waitingForTurnStartRef = useRef(false);
  const waitingForTurnCompletionRef = useRef(false);
  const waitingForBusyReleaseRef = useRef(false);
  const observedBusyBlockedGateRef = useRef(false);
  const interactionLockedRef = useRef(false);
  const onExecuteRef = useRef(onExecute);
  const [isInteractionLocked, setIsInteractionLocked] = useState(false);
  const [executionGateVersion, setExecutionGateVersion] = useState(0);

  useEffect(() => {
    stateRef.current = data;
  }, [data]);

  useEffect(() => {
    onExecuteRef.current = onExecute;
  }, [onExecute]);

  useEffect(() => {
    if (waitingForBusyReleaseRef.current) {
      if (!executionGate.hydrated || !executionGate.canExecute || executionGate.isProcessing) {
        observedBusyBlockedGateRef.current = true;
        return;
      }

      if (!observedBusyBlockedGateRef.current) {
        return;
      }

      waitingForBusyReleaseRef.current = false;
      observedBusyBlockedGateRef.current = false;
      waitingForTurnStartRef.current = false;
      waitingForTurnCompletionRef.current = false;
      logCommandQueue(conversation_id, 'busy-release', {
        pendingItemCount: stateRef.current.items.length,
      });
    }

    if (waitingForTurnStartRef.current && executionGate.isProcessing) {
      observedBusyBlockedGateRef.current = true;
      waitingForTurnStartRef.current = false;
      waitingForTurnCompletionRef.current = true;
      logCommandQueue(conversation_id, 'turn-started', {
        pendingItemCount: stateRef.current.items.length,
      });
      return;
    }

    if (waitingForTurnStartRef.current && executionGate.hydrated && executionGate.canExecute) {
      waitingForTurnStartRef.current = false;
      waitingForTurnCompletionRef.current = false;
      observedBusyBlockedGateRef.current = false;
      logCommandQueue(conversation_id, 'turn-finished-without-observed-start', {
        pendingItemCount: stateRef.current.items.length,
      });
    }

    if (waitingForTurnCompletionRef.current && executionGate.hydrated && executionGate.canExecute) {
      waitingForTurnCompletionRef.current = false;
      logCommandQueue(conversation_id, 'turn-finished', {
        pendingItemCount: stateRef.current.items.length,
      });
    }
  }, [
    conversation_id,
    data.items.length,
    executionGate.canExecute,
    executionGate.hydrated,
    executionGate.isProcessing,
  ]);

  useEffect(() => {
    pausedRef.current = data.isPaused;
  }, [data.isPaused]);

  useEffect(() => {
    interactionLockedRef.current = isInteractionLocked;
  }, [isInteractionLocked]);

  useEffect(() => {
    if (!enabled || retainUntilAccepted) {
      return;
    }

    registerBackgroundCommandQueueRunner({
      conversation_id,
      onExecute: async (item) => {
        await onExecuteRef.current(item);
      },
    });

    return () => {
      detachBackgroundCommandQueueRunner(conversation_id);
    };
  }, [conversation_id, enabled, retainUntilAccepted]);

  useEffect(() => {
    if (enabled || preserveWhenDisabled) {
      return;
    }

    waitingForTurnStartRef.current = false;
    waitingForTurnCompletionRef.current = false;
    waitingForBusyReleaseRef.current = false;
    observedBusyBlockedGateRef.current = false;
    pausedRef.current = false;
    interactionLockedRef.current = false;
    stateRef.current = createDefaultQueueState();
    setIsInteractionLocked(false);
    removePersistedQueueState(queueKey);
    void mutate(createDefaultQueueState(), { revalidate: false });
  }, [conversation_id, queueKey, enabled, mutate, preserveWhenDisabled]);

  const updateState = useCallback(
    (
      updater: (state: ConversationCommandQueueState) => ConversationCommandQueueState
    ): Promise<ConversationCommandQueueState | undefined> => {
      if (!enabled) {
        const nextState = createDefaultQueueState();
        stateRef.current = nextState;
        pausedRef.current = false;
        removePersistedQueueState(queueKey);
        return Promise.resolve(nextState);
      }

      return mutate(
        (current) => {
          if (retainUntilAccepted && epoch !== queueEpoch) throw new Error('Request owner changed');
          const nextState = normalizeQueueState(updater(current ?? createDefaultQueueState()));
          persistQueueState(queueKey, nextState, retainUntilAccepted);
          stateRef.current = nextState;
          pausedRef.current = nextState.isPaused;
          return nextState;
        },
        { revalidate: false }
      );
    },
    [conversation_id, queueKey, enabled, mutate, retainUntilAccepted, epoch]
  );

  const clear = useCallback(() => {
    waitingForTurnStartRef.current = false;
    waitingForTurnCompletionRef.current = false;
    waitingForBusyReleaseRef.current = false;
    observedBusyBlockedGateRef.current = false;
    pausedRef.current = false;
    logCommandQueue(conversation_id, 'cleared');
    void updateState((state) => ({ ...createDefaultQueueState(), items: state.items.filter((item) => item.pending) }));
  }, [conversation_id, updateState]);

  useAddEventListener(
    'conversation.deleted',
    (deletedConversationId) => {
      if (deletedConversationId !== conversation_id) {
        return;
      }
      clear();
      if (!stateRef.current.items.some((item) => item.pending)) removePersistedQueueState(queueKey);
    },
    [clear, conversation_id]
  );

  const enqueue = useCallback(
    ({ input, files, sessions }: EnqueueCommandInput) => {
      if (!enabled) {
        return null;
      }

      const currentState = normalizeQueueState(stateRef.current);
      if (retainUntilAccepted && epoch !== queueEpoch) throw new Error('Request owner changed');
      const draft = createQueuedCommandItem({ input, files, sessions });
      const item = prepareItem ? prepareItem(draft) : draft;
      if (retainUntilAccepted && !item.request) throw new Error('Native admission unavailable');
      const validation = validateQueuedCommandItem(item, currentState);

      if (isQueueValidationFailure(validation)) {
        const reason: QueueValidationFailureReason = validation.reason;
        logCommandQueue(conversation_id, 'enqueue-rejected', {
          reason,
          item: summarizeQueuedCommand(item),
          currentItemCount: currentState.items.length,
        });
        Message.warning(getQueueValidationMessage(t, reason));
        return null;
      }

      const nextState: ConversationCommandQueueState = {
        ...currentState,
        items: [...currentState.items, item],
      };
      if (retainUntilAccepted) persistQueueState(queueKey, nextState, true);
      stateRef.current = nextState;
      logCommandQueue(conversation_id, 'enqueued', {
        item: summarizeQueuedCommand(item),
        currentItemCount: currentState.items.length,
      });
      void updateState(() => nextState);
      return item;
    },
    [conversation_id, queueKey, enabled, t, updateState, prepareItem, retainUntilAccepted, epoch]
  );

  const update = useCallback(
    (commandId: string, { input }: UpdateCommandInput) => {
      if (!enabled) {
        return false;
      }

      const currentState = normalizeQueueState(stateRef.current);
      const currentItem = currentState.items.find((item) => item.id === commandId);
      if (!currentItem || currentItem.pending) {
        return false;
      }

      const nextItems = updateQueuedCommand(currentState.items, commandId, { input }).map((item) =>
        item.id === commandId && prepareItem ? prepareItem({ ...item, request: undefined }) : item
      );
      const nextState: ConversationCommandQueueState = {
        ...currentState,
        isPaused: false,
        items: nextItems,
      };
      const failureReason = getQueueValidationFailureReason(nextState);

      if (failureReason) {
        logCommandQueue(conversation_id, 'update-rejected', {
          reason: failureReason,
          commandId,
          inputLength: input.length,
        });
        Message.warning(getQueueValidationMessage(t, failureReason));
        return false;
      }

      stateRef.current = nextState;
      logCommandQueue(conversation_id, 'updated', {
        commandId,
        inputLength: input.length,
      });
      void updateState(() => nextState);
      return true;
    },
    [conversation_id, enabled, t, updateState, prepareItem]
  );

  const remove = useCallback(
    (commandId: string) => {
      if (!enabled) {
        return;
      }

      logCommandQueue(conversation_id, 'removed', {
        commandId,
      });
      void updateState((state) => {
        const nextItems = state.items.filter((item) => item.id !== commandId || item.pending);
        return {
          ...state,
          items: nextItems,
          isPaused: false,
        };
      });
    },
    [conversation_id, enabled, updateState]
  );

  const prioritize = useCallback(
    (commandId: string) => {
      if (!enabled) {
        return;
      }
      logCommandQueue(conversation_id, 'prioritized', { commandId });
      void updateState((state) => {
        const target = state.items.find((item) => item.id === commandId);
        if (!target) return state;
        return {
          ...state,
          items: [target, ...removeQueuedCommand(state.items, commandId)],
          isPaused: false,
          mode: 'auto',
        };
      });
    },
    [conversation_id, enabled, updateState]
  );

  const executeRetained = useCallback(
    async (item: ConversationCommandQueueItem, action: 'send' | 'lookup' | 'reconcile') => {
      if (retainedExecuting.current || stateRef.current.items.some((entry) => entry.pending && entry.id !== item.id))
        return;
      retainedExecuting.current = true;
      const target = { ...item, pending: true };
      try {
        await updateState((state) => ({ ...state, items: restoreQueuedCommand(state.items, target), isPaused: true }));
        if (epoch !== queueEpoch) throw new Error('Request owner changed');
        if (!item.request) throw new Error('Stored request metadata is invalid');
        const result = await onExecuteRef.current(target, item.recorded && action === 'send' ? 'reconcile' : action);
        if (result === 'recorded')
          await updateState((state) => ({
            ...state,
            items: restoreQueuedCommand(state.items, { ...target, recorded: true }),
          }));
        else if (result !== false)
          await updateState((state) => ({
            ...state,
            items: removeQueuedCommand(state.items, target.id),
            isPaused: false,
          }));
      } catch {
        // The stored request is still unresolved. Never manufacture a new retry ID.
      } finally {
        retainedExecuting.current = false;
      }
    },
    [updateState, epoch]
  );

  useEffect(() => {
    if (!enabled || !retainUntilAccepted || restoredQueue.current === queueKey) return;
    restoredQueue.current = queueKey;
    const pending = readPersistedQueueState(queueKey).items.find((item) => item.pending);
    if (pending) void executeRetained(pending, 'lookup');
  }, [enabled, retainUntilAccepted, queueKey, executeRetained]);

  const reconcile = useCallback(
    (commandId: string) => {
      const item = stateRef.current.items.find((entry) => entry.id === commandId);
      if (item?.pending) void executeRetained(item, 'reconcile');
    },
    [executeRetained]
  );

  const sendNow = useCallback(
    async (commandId: string) => {
      if (!enabled) {
        return;
      }

      const currentState = normalizeQueueState(stateRef.current);
      const target = currentState.items.find((item) => item.id === commandId);
      if (!target) {
        return;
      }

      if (retainUntilAccepted) {
        await executeRetained(target, 'send');
        return;
      }

      // Remove only the targeted command; the rest keep their mode, order and paused flag.
      const nextItems = removeQueuedCommand(currentState.items, commandId);
      waitingForTurnStartRef.current = true;
      waitingForTurnCompletionRef.current = false;
      observedBusyBlockedGateRef.current = false;
      pausedRef.current = false;
      logCommandQueue(conversation_id, 'send-now', {
        item: summarizeQueuedCommand(target),
        remainingItemCount: nextItems.length,
      });
      void updateState((state) => ({
        ...state,
        items: removeQueuedCommand(state.items, commandId),
        isPaused: false,
      }));

      void onExecuteRef.current(target).catch((error) => {
        const busyError = classifyConversationBusyError(error);
        if (busyError) {
          waitingForBusyReleaseRef.current = true;
          waitingForTurnStartRef.current = false;
          waitingForTurnCompletionRef.current = true;
          pausedRef.current = false;
          logCommandQueue(conversation_id, 'send-now-busy-wait', {
            item: summarizeQueuedCommand(target),
            busyKind: busyError.kind,
            status: busyError.status,
            code: busyError.code,
            remainingItemCount: nextItems.length + 1,
          });
          void updateState((state) => ({
            ...state,
            items: restoreQueuedCommand(state.items, target),
            isPaused: false,
          }));
          return;
        }
        console.error('[conversation-command-queue] Failed to send queued command now:', error);
        logCommandQueue(conversation_id, 'send-now-failed', {
          item: summarizeQueuedCommand(target),
          error: error instanceof Error ? error.message : String(error),
        });
        waitingForTurnStartRef.current = false;
        waitingForTurnCompletionRef.current = false;
        pausedRef.current = true;
        void updateState((state) => ({
          ...state,
          items: restoreQueuedCommand(state.items, target),
          isPaused: true,
        }));
        Message.warning(
          t('conversation.commandQueue.pausedAfterFailure', {
            defaultValue: 'The next queued command could not start. Edit, reorder, or remove it to continue.',
          })
        );
      });
    },
    [conversation_id, enabled, t, updateState, retainUntilAccepted, executeRetained]
  );

  const reorder = useCallback(
    (activeCommandId: string, overCommandId: string) => {
      if (!enabled) {
        return;
      }

      logCommandQueue(conversation_id, 'reordered', {
        activeCommandId,
        overCommandId,
      });
      void updateState((state) => ({
        ...state,
        isPaused: false,
        items: reorderQueuedCommand(state.items, activeCommandId, overCommandId),
      }));
    },
    [conversation_id, enabled, updateState]
  );

  const pause = useCallback(() => {
    if (!enabled) {
      return;
    }

    pausedRef.current = true;
    waitingForTurnStartRef.current = false;
    waitingForTurnCompletionRef.current = false;
    waitingForBusyReleaseRef.current = false;
    observedBusyBlockedGateRef.current = false;
    logCommandQueue(conversation_id, 'paused', {
      itemCount: data.items.length,
    });
    void updateState((state) => {
      if (state.items.length === 0) {
        pausedRef.current = false;
        return createDefaultQueueState();
      }
      return {
        ...state,
        isPaused: true,
      };
    });
  }, [conversation_id, data.items.length, enabled, updateState]);

  const resume = useCallback(() => {
    if (!enabled) {
      return;
    }

    pausedRef.current = false;
    logCommandQueue(conversation_id, 'resumed', {
      itemCount: data.items.length,
    });
    void updateState((state) => ({
      ...state,
      isPaused: state.items.length > 0 ? false : state.isPaused,
    }));
  }, [conversation_id, data.items.length, enabled, updateState]);

  const toggleMode = useCallback(() => {
    if (!enabled) {
      return;
    }

    void updateState((state) => {
      const nextMode: ConversationCommandQueueMode = state.mode === 'auto' ? 'manual' : 'auto';
      logCommandQueue(conversation_id, 'mode-changed', { mode: nextMode });
      return {
        ...state,
        mode: nextMode,
      };
    });
  }, [conversation_id, enabled, updateState]);

  const lockInteraction = useCallback(() => {
    if (!enabled) {
      return;
    }

    interactionLockedRef.current = true;
    logCommandQueue(conversation_id, 'interaction-locked', {
      itemCount: stateRef.current.items.length,
    });
    setIsInteractionLocked(true);
  }, [conversation_id, enabled]);

  const unlockInteraction = useCallback(() => {
    if (!enabled) {
      return;
    }

    interactionLockedRef.current = false;
    logCommandQueue(conversation_id, 'interaction-unlocked', {
      itemCount: stateRef.current.items.length,
    });
    setIsInteractionLocked(false);
  }, [conversation_id, enabled]);

  const resetActiveExecution = useCallback(
    (reason: 'stop' | 'external-reset') => {
      const hadPendingTurn =
        waitingForTurnStartRef.current || waitingForTurnCompletionRef.current || waitingForBusyReleaseRef.current;
      waitingForTurnStartRef.current = false;
      waitingForTurnCompletionRef.current = false;
      waitingForBusyReleaseRef.current = false;
      observedBusyBlockedGateRef.current = false;

      if (!hadPendingTurn) {
        return;
      }

      logCommandQueue(conversation_id, 'execution-reset', {
        reason,
        pendingItemCount: stateRef.current.items.length,
      });
      setExecutionGateVersion((version) => version + 1);
    },
    [conversation_id]
  );

  useEffect(() => {
    if (
      !enabled ||
      data.mode === 'manual' ||
      !executionGate.hydrated ||
      pausedRef.current ||
      !executionGate.canExecute ||
      waitingForTurnStartRef.current ||
      waitingForTurnCompletionRef.current ||
      waitingForBusyReleaseRef.current ||
      interactionLockedRef.current ||
      data.items.length === 0
    ) {
      return;
    }

    const [nextCommand, ...remainingCommands] = data.items;
    if (retainUntilAccepted) {
      if (!data.items.some((item) => item.pending)) void executeRetained(nextCommand, 'send');
      return;
    }
    waitingForTurnStartRef.current = true;
    observedBusyBlockedGateRef.current = false;
    logCommandQueue(conversation_id, 'dequeued', {
      item: summarizeQueuedCommand(nextCommand),
      remainingItemCount: remainingCommands.length,
    });

    // Await the state update so the item leaves the UI only once the send is
    // confirmed, preventing it from disappearing before the backend accepts it.
    void updateState((state) => ({
      ...state,
      items: remainingCommands,
      isPaused: false,
    })).then(() =>
      onExecuteRef.current(nextCommand).catch((error) => {
        const busyError = classifyConversationBusyError(error);
        if (busyError) {
          waitingForBusyReleaseRef.current = true;
          waitingForTurnStartRef.current = false;
          waitingForTurnCompletionRef.current = true;
          pausedRef.current = false;
          logCommandQueue(conversation_id, 'busy-wait', {
            item: summarizeQueuedCommand(nextCommand),
            busyKind: busyError.kind,
            status: busyError.status,
            code: busyError.code,
            remainingItemCount: remainingCommands.length + 1,
          });
          void updateState((state) => ({
            ...state,
            items: restoreQueuedCommand(state.items, nextCommand),
            isPaused: false,
          }));
          return;
        }
        console.error('[conversation-command-queue] Failed to execute queued command:', error);
        logCommandQueue(conversation_id, 'execute-failed', {
          item: summarizeQueuedCommand(nextCommand),
          error: error instanceof Error ? error.message : String(error),
        });
        waitingForTurnStartRef.current = false;
        waitingForTurnCompletionRef.current = false;
        pausedRef.current = true;
        void updateState((state) => ({
          ...state,
          items: restoreQueuedCommand(state.items, nextCommand),
          isPaused: true,
        }));
        Message.warning(
          t('conversation.commandQueue.pausedAfterFailure', {
            defaultValue: 'The next queued command could not start. Edit, reorder, or remove it to continue.',
          })
        );
      })
    );
  }, [
    conversation_id,
    data.items,
    data.mode,
    enabled,
    executionGateVersion,
    executionGate.canExecute,
    executionGate.hydrated,
    executionGate.isProcessing,
    isInteractionLocked,
    t,
    updateState,
    retainUntilAccepted,
    executeRetained,
  ]);

  return {
    items: enabled ? data.items : [],
    isPaused: enabled ? data.isPaused : false,
    mode: enabled ? data.mode : 'manual',
    isInteractionLocked,
    hasPendingCommands: enabled ? data.items.length > 0 : false,
    enqueue,
    update,
    remove,
    prioritize,
    sendNow,
    reconcile,
    clear,
    reorder,
    pause,
    resume,
    toggleMode,
    lockInteraction,
    unlockInteraction,
    resetActiveExecution,
  };
};

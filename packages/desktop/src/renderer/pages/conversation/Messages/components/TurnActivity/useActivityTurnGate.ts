import type { TMessage } from '@/common/chat/chatLib';
import { useRef } from 'react';

type ActivityRuntime = {
  isProcessing: boolean;
  activeTurnId?: string | null;
  localSubmitting?: boolean;
  hydrated?: boolean;
};
type ActivityGateSnapshot = {
  conversationId: string;
  busy: boolean;
  submitting: boolean;
  hydrated: boolean;
  turnId?: string | null;
  boundary: string;
  blockedBoundary?: string;
};

/** Conversation-wide busy state does not identify the last loaded turn. Keep
 * that completed turn settled while a new send waits for its API/user row.
 * Initial recovery can use the authoritative latest history window, including
 * a partial turn; local/observed turn transitions must see a new user boundary.
 */
export const useActivityTurnGate = (
  conversationId: string,
  messages: TMessage[],
  runtime: ActivityRuntime,
  atLatest: boolean
): boolean => {
  const previousRef = useRef<ActivityGateSnapshot | undefined>(undefined);
  const user = messages.findLast((message) => !message.hidden && message.position === 'right');
  const boundary = user?.msg_id || user?.id || 'history-start';
  const previous = previousRef.current?.conversationId === conversationId ? previousRef.current : undefined;
  let blockedBoundary = previous?.blockedBoundary;
  if (!runtime.isProcessing) {
    blockedBoundary = undefined;
  } else if (
    previous &&
    ((runtime.localSubmitting && !previous.submitting) ||
      (previous.hydrated && !previous.busy) ||
      (previous.hydrated && !previous.submitting && runtime.activeTurnId !== previous.turnId))
  ) {
    blockedBoundary = previous.boundary;
  }
  previousRef.current = {
    conversationId,
    busy: runtime.isProcessing,
    submitting: runtime.localSubmitting === true,
    hydrated: runtime.hydrated === true,
    turnId: runtime.activeTurnId,
    boundary: atLatest ? boundary : (previous?.boundary ?? boundary),
    blockedBoundary,
  };
  return (
    runtime.isProcessing &&
    !runtime.localSubmitting &&
    atLatest &&
    (blockedBoundary === undefined || boundary !== blockedBoundary)
  );
};

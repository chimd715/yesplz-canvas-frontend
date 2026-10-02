import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TMessage } from '@/common/chat/chatLib';
import type { TConversationRuntimeSummary } from '@/common/config/storage';
import {
  createDefaultConversationRuntimeView,
  localSendAcceptedConversationRuntimeView,
  localSendFailedConversationRuntimeView,
  localSendStartedConversationRuntimeView,
} from '@/renderer/pages/conversation/runtime/conversationRuntimeViewStore';
import { useActivityTurnGate } from '@/renderer/pages/conversation/Messages/components/TurnActivity';

const user = (id: string): TMessage => ({
  id,
  msg_id: id,
  conversation_id: 'conversation-1',
  type: 'text',
  position: 'right',
  content: { content: 'Build it' },
});
const completedThinking: TMessage = {
  id: 'old-thinking',
  msg_id: 'old-segment',
  type: 'thinking',
  conversation_id: 'conversation-1',
  content: { content: 'Finished old work', status: 'done' },
};
const idle = { ...createDefaultConversationRuntimeView('conversation-1'), hydrated: true };
const running: TConversationRuntimeSummary = {
  state: 'running',
  turn_id: 'new-turn',
  is_processing: true,
  can_send_message: false,
  has_task: true,
  pending_confirmations: 0,
};

describe('activity ownership during runtime changes', () => {
  it('keeps the previous completed turn settled during a deferred send and after rejection', () => {
    const messages = [user('old-user'), completedThinking];
    const { result, rerender } = renderHook(
      ({ runtime }) => useActivityTurnGate('conversation-1', messages, runtime, true),
      { initialProps: { runtime: idle } }
    );
    const submitting = localSendStartedConversationRuntimeView(idle, 'conversation-1').view;
    rerender({ runtime: submitting });
    expect(result.current).toBe(false);
    // The API is still deferred: no new user row or activity has arrived.
    rerender({ runtime: { ...submitting } });
    expect(result.current).toBe(false);
    rerender({
      runtime: localSendFailedConversationRuntimeView(submitting, 'conversation-1', {
        kind: 'ordinary',
        reason: 'Disconnected',
      }).view,
    });
    expect(result.current).toBe(false);
  });

  it('waits for the newly accepted turn user boundary even if its API reply wins the history event race', () => {
    const oldMessages = [user('old-user'), completedThinking];
    const { result, rerender } = renderHook(
      ({ runtime, messages }) => useActivityTurnGate('conversation-1', messages, runtime, true),
      { initialProps: { runtime: idle, messages: oldMessages } }
    );
    const submitting = localSendStartedConversationRuntimeView(idle, 'conversation-1').view;
    rerender({ runtime: submitting, messages: oldMessages });
    const accepted = localSendAcceptedConversationRuntimeView(submitting, 'conversation-1', 'new-turn', running).view;
    rerender({ runtime: accepted, messages: oldMessages });
    expect(result.current).toBe(false);
    rerender({ runtime: accepted, messages: [...oldMessages, user('new-user')] });
    expect(result.current).toBe(true);
  });

  it('does not reactivate old activity when runtime acceptance is batched without a submitting render', () => {
    const messages = [user('old-user'), completedThinking];
    const { result, rerender } = renderHook(
      ({ runtime }) => useActivityTurnGate('conversation-1', messages, runtime, true),
      { initialProps: { runtime: idle } }
    );
    rerender({ runtime: localSendAcceptedConversationRuntimeView(idle, 'conversation-1', 'new-turn', running).view });
    expect(result.current).toBe(false);
  });

  it('allows a new user row that arrives while its API reply is still deferred', () => {
    const oldMessages = [user('old-user'), completedThinking];
    const { result, rerender } = renderHook(
      ({ runtime, messages }) => useActivityTurnGate('conversation-1', messages, runtime, true),
      { initialProps: { runtime: idle, messages: oldMessages } }
    );
    const submitting = localSendStartedConversationRuntimeView(idle, 'conversation-1').view;
    rerender({ runtime: submitting, messages: oldMessages });
    const newMessages = [...oldMessages, user('new-user')];
    rerender({ runtime: submitting, messages: newMessages });
    expect(result.current).toBe(false);
    rerender({
      runtime: localSendAcceptedConversationRuntimeView(submitting, 'conversation-1', 'new-turn', running).view,
      messages: newMessages,
    });
    expect(result.current).toBe(true);
  });

  it('waits for each queued turn boundary even when no idle state renders between accepted turns', () => {
    const oldMessages = [user('old-user'), completedThinking];
    const { result, rerender } = renderHook(
      ({ runtime, messages }) => useActivityTurnGate('conversation-1', messages, runtime, true),
      { initialProps: { runtime: idle, messages: oldMessages } }
    );
    const first = localSendAcceptedConversationRuntimeView(idle, 'conversation-1', 'new-turn', running).view;
    const firstMessages = [...oldMessages, user('new-user')];
    rerender({ runtime: first, messages: firstMessages });
    expect(result.current).toBe(true);
    const next = localSendAcceptedConversationRuntimeView(first, 'conversation-1', 'next-turn', {
      ...running,
      turn_id: 'next-turn',
    }).view;
    rerender({ runtime: next, messages: firstMessages });
    expect(result.current).toBe(false);
    rerender({ runtime: next, messages: [...firstMessages, user('next-user')] });
    expect(result.current).toBe(true);
  });

  it('allows initial active recovery of a bounded partial latest turn and keeps older windows settled', () => {
    const runtime = localSendAcceptedConversationRuntimeView(undefined, 'conversation-1', 'new-turn', running).view;
    const { result, rerender } = renderHook(
      ({ atLatest }) => useActivityTurnGate('conversation-1', [completedThinking], runtime, atLatest),
      { initialProps: { atLatest: true } }
    );
    expect(result.current).toBe(true);
    rerender({ atLatest: false });
    expect(result.current).toBe(false);
  });

  it('keeps initial hydration from blocking active history when runtime resolves before messages', () => {
    const empty = createDefaultConversationRuntimeView('conversation-1');
    const { result, rerender } = renderHook(
      ({ runtime, messages }) => useActivityTurnGate('conversation-1', messages, runtime, true),
      { initialProps: { runtime: empty, messages: [] as TMessage[] } }
    );
    const runtime = localSendAcceptedConversationRuntimeView(undefined, 'conversation-1', 'new-turn', running).view;
    rerender({ runtime, messages: [] });
    rerender({ runtime, messages: [completedThinking] });
    expect(result.current).toBe(true);
  });
});

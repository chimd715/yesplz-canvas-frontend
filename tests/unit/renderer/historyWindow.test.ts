import { describe, expect, it } from 'vitest';
import type { IMessageText, IMessageToolCall } from '@/common/chat/chatLib';
import {
  appendHistoryPage,
  historyMessageKey,
  replaceHistoryWindow,
} from '@/renderer/pages/conversation/Messages/historyNavigation/historyWindow';

const row = (id: string, content = id, conversation = 'chat'): IMessageText => ({
  id,
  msg_id: id,
  conversation_id: conversation,
  type: 'text',
  position: 'left',
  created_at: Number(id.replace(/\D/g, '')) || 0,
  content: { content },
});

describe('bounded history windows', () => {
  it('preserves a post-query delivery status while choosing the complete text', () => {
    const pending = { ...row('user', 'same question'), position: 'right' as const, status: 'pending' as const };
    const completed = { ...pending, status: 'finish' as const };
    const result = replaceHistoryWindow(
      'chat',
      [pending],
      [completed],
      new Map([[historyMessageKey(pending), pending]])
    );
    expect(result[0]).toMatchObject({ status: 'finish', content: { content: 'same question' } });
  });
  it('replaces hundreds of loaded rows with the single requested first page', () => {
    const current = Array.from({ length: 600 }, (_, index) => row(`row-${index + 1}`));
    const first = current.slice(0, 50);
    expect(replaceHistoryWindow('chat', first, current)).toEqual(first);
    expect(replaceHistoryWindow('chat', first, current)).toHaveLength(50);
  });

  it('retains a richer overlapping live text frame but no unrelated tail', () => {
    const current = [row('one', 'Streamed complete answer'), row('two')];
    const result = replaceHistoryWindow('chat', [row('one', 'Streamed')], current);
    expect(result).toHaveLength(1);
    expect(result[0].content).toEqual({ content: 'Streamed complete answer' });
  });

  it('retains only new live frames received during a latest read', () => {
    const snapshot = new Map([row('old'), row('overlap')].map((message) => [historyMessageKey(message), message]));
    const result = replaceHistoryWindow(
      'chat',
      [row('overlap')],
      [row('old'), row('overlap'), row('arrived-during-read'), row('foreign', 'foreign', 'other')],
      snapshot
    );
    expect(result.map((message) => message.id)).toEqual(['overlap', 'arrived-during-read']);
  });

  it('merges a persisted answer and a live answer with different IDs and the same protocol message ID', () => {
    const persisted = { ...row('database-row', 'partial'), msg_id: 'turn-message' };
    const live = { ...row('renderer-uuid', 'partial completed answer'), msg_id: 'turn-message' };
    const result = replaceHistoryWindow('chat', [persisted], [live], new Map());
    expect(result).toHaveLength(1);
    expect(result[0].content).toEqual({ content: 'partial completed answer' });
    expect(appendHistoryPage('chat', [live], [persisted])).toEqual([live]);
  });

  it('continues forward from the bounded first window without duplicates or other conversations', () => {
    const result = appendHistoryPage(
      'chat',
      [row('one'), row('two')],
      [row('two'), row('three'), row('foreign', '', 'other')]
    );
    expect(result.map((message) => message.id)).toEqual(['one', 'two', 'three']);
  });

  it('preserves distinct tool calls that share a turn message ID', () => {
    const tool = (callId: string): IMessageToolCall => ({
      ...row(callId),
      type: 'tool_call',
      msg_id: 'turn',
      content: { name: 'Write', args: {}, call_id: callId },
    });
    expect(appendHistoryPage('chat', [tool('call-one')], [tool('call-two')])).toHaveLength(2);
    expect(
      replaceHistoryWindow(
        'chat',
        [tool('call-two')],
        [tool('call-one')],
        new Map([[historyMessageKey(tool('call-one')), tool('call-one')]])
      )
    ).toEqual([tool('call-two')]);
  });
});

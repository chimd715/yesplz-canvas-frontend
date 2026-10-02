import { describe, expect, it, vi } from 'vitest';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import { composeMessage, transformMessage, type TMessage } from '@/common/chat/chatLib';
import {
  getActivityTools,
  latestActivityMessage,
  projectTurnActivities,
} from '@/renderer/pages/conversation/Messages/components/TurnActivity/activityTimeline';
import type { TurnActivitySummary } from '@/renderer/pages/conversation/Messages/components/TurnActivity/types';

const frame = (type: IResponseMessage['type'], data: unknown, msgId = 'assistant-1', createdAt = 2): TMessage =>
  transformMessage({
    type,
    data,
    msg_id: msgId,
    conversation_id: 'conversation-1',
    created_at: createdAt,
  } as IResponseMessage)!;
const user = (id = 'user-1', createdAt = 1): TMessage => ({
  id,
  type: 'text',
  position: 'right',
  conversation_id: 'conversation-1',
  created_at: createdAt,
  content: { content: 'Please build it' },
});
const legacyThinking = (id: string): TMessage => ({
  id,
  type: 'thinking',
  conversation_id: 'conversation-1',
  content: { content: id, status: 'done' },
});
const summaries = (messages: TMessage[], isProcessing = false, atLatest = true) =>
  projectTurnActivities(messages, { isProcessing, atLatest }).filter(
    (item): item is TurnActivitySummary => item.type === 'activity_summary'
  );

describe('retained turn activity', () => {
  it('keeps one stable row across reasoning, tools and interleaved answer text', () => {
    const thinking = frame('thinking', { content: 'Plan the work', status: 'thinking' });
    const initial = summaries([user(), thinking], true)[0];
    const expanded = summaries(
      [
        user(),
        thinking,
        frame('content', { content: 'First result' }),
        frame('tool_call', { call_id: 'call-1', name: 'Write', args: { file_path: 'document.md' }, status: 'running' }),
        frame('thinking', { content: 'Verify the output', status: 'thinking' }),
        frame('content', { content: 'Final result' }),
      ],
      true
    );
    expect(expanded).toHaveLength(1);
    expect(expanded[0].id).toBe(initial.id);
    expect(expanded[0].messages.map((message) => message.type)).toEqual(['thinking', 'tool_call', 'thinking']);
  });

  it('groups actual Core segment and persisted tool msg_ids within one user boundary', () => {
    const messages = [
      user(),
      frame('thinking', { content: 'Plan the document' }, 'minted-thinking-segment-1', 2),
      frame('content', { content: 'Prepare the file' }, 'minted-text-segment-1', 3),
      frame(
        'tool_call',
        { call_id: 'aionrs-write-1', name: 'Write', args: {}, status: 'completed', output: 'Done' },
        'aionrs-write-1',
        4
      ),
      frame('thinking', { content: 'Verify the document' }, 'minted-thinking-segment-2', 5),
      frame('content', { content: 'Here is the document' }, 'minted-text-segment-2', 6),
    ];
    const rows = summaries(messages);
    expect(rows).toHaveLength(1);
    expect(rows[0].messages.map((message) => message.msg_id)).toEqual([
      'minted-thinking-segment-1',
      'aionrs-write-1',
      'minted-thinking-segment-2',
    ]);
    expect(projectTurnActivities(messages).filter((item) => item.type === 'text')).toHaveLength(3);
  });

  it('keeps distinct turns and does not mark the old row running after a new user prompt', () => {
    const rows = summaries(
      [
        user(),
        frame('thinking', { content: 'Old reasoning' }),
        user('user-2', 3),
        frame('thinking', { content: 'New reasoning' }, 'assistant-2', 4),
      ],
      true
    );
    expect(rows.map((row) => row.active)).toEqual([false, true]);
    expect(rows[0].id).not.toBe(rows[1].id);
    expect(
      summaries([user(), frame('thinking', { content: 'Old reasoning' }), user('user-2', 3)], true)[0].active
    ).toBe(false);
  });

  it('reconstructs the same complete activity identity after history reload', () => {
    const live = [
      frame('thinking', { content: 'Analyze' }),
      frame('tool_call', { call_id: 'call-1', name: 'Read', args: {}, status: 'completed', output: 'Found it' }),
    ];
    const recovered = live.map(
      ({ activity_updated_at: _transient, ...message }, index) => ({ ...message, id: `database-${index}` }) as TMessage
    );
    expect(summaries(recovered)[0].id).toBe(summaries(live, true)[0].id);
    expect(summaries(recovered)[0].messages).toHaveLength(2);
    expect(summaries(recovered)[0].active).toBe(false);
  });

  it('handles a partial older history window without adding current-turn activity or a spinner', () => {
    const older = [frame('thinking', { content: 'Earlier task' }, 'old-turn')];
    const rows = summaries(older, true, false);
    expect(rows).toHaveLength(1);
    expect(rows[0].active).toBe(false);
    expect(rows[0].messages[0].msg_id).toBe('old-turn');
  });

  it('uses user boundaries for legacy rows without msg_id', () => {
    const rows = summaries([user(), legacyThinking('legacy-1'), user('user-2'), legacyThinking('legacy-2')]);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.sourceMessageIds)).toEqual([['legacy-1'], ['legacy-2']]);
  });

  it('excludes formal questions and secret operations before any transcript rendering', () => {
    const messages = [
      user(),
      ...[
        'AskUserQuestion',
        'request_secret',
        'mcp__build-your-own-secrets__get_secret_status',
        'build-your-own-secrets.github_identity',
      ].map((name, index) =>
        frame('tool_call', {
          call_id: `sensitive-${index}`,
          name,
          args: { private: 'do-not-render' },
          status: 'completed',
          output: 'do-not-render',
        })
      ),
    ];
    expect(projectTurnActivities(messages)).toEqual([messages[0]]);
    expect(JSON.stringify(projectTurnActivities(messages))).not.toContain('do-not-render');
  });

  it('removes secure entries from mixed tool groups without mutating captured input', () => {
    const message = frame('tool_group', [
      { call_id: 'ordinary', name: 'Read', status: 'Success', description: 'Read file' },
      {
        call_id: 'secure',
        name: 'MCP',
        status: 'Success',
        description: 'private',
        confirmationDetails: { type: 'mcp', tool_name: 'request_secret' },
      },
    ]);
    const row = summaries([message])[0];
    expect(getActivityTools(row.messages[0]).map((tool) => tool.name)).toEqual(['Read']);
    expect(JSON.stringify(row)).not.toContain('private');
    expect(message.content as unknown[]).toHaveLength(2);
  });

  it('excludes the pinned Core MCP collision-name format while preserving ordinary similarly named tools', () => {
    const sensitive = ['AskUserQuestion', 'request_secret', 'get_secret_status', 'github_identity'].map((name, index) =>
      frame('tool_call', {
        call_id: `collision-${index}`,
        name: `mcp__build-your-own-secrets_${name}`,
        args: { private: 'do-not-render' },
        status: 'completed',
        output: 'do-not-render',
      })
    );
    const ordinary = frame('tool_call', {
      call_id: 'ordinary',
      name: 'save_request_secret_file',
      args: {},
      status: 'completed',
      output: 'Ordinary file saved',
    });
    const rows = summaries([...sensitive, ordinary]);
    expect(rows[0].messages).toEqual([ordinary]);
    expect(JSON.stringify(rows)).not.toContain('do-not-render');
  });

  it('drops malformed activity instead of throwing or creating empty rows', () => {
    const malformed = [null, undefined, [], 'bad', { content: 42 }].map(
      (content) => ({ id: 'bad', type: 'thinking', conversation_id: 'conversation-1', content }) as TMessage
    );
    expect(() => projectTurnActivities(malformed)).not.toThrow();
    expect(projectTurnActivities(malformed)).toEqual([]);
  });

  it('shows the most recent update when tools settle in reverse creation order in the same millisecond', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    let messages: TMessage[] = [];
    for (const [call_id, name, status] of [
      ['first', 'Read', 'running'],
      ['second', 'Write', 'running'],
      ['first', 'Read', 'completed'],
    ]) {
      messages = composeMessage(
        frame('tool_call', {
          call_id,
          name,
          status,
          args: status === 'running' ? { path: `${call_id}.md` } : null,
          output: status === 'completed' ? 'Read successfully' : undefined,
        }),
        messages
      );
    }
    const latest = latestActivityMessage(summaries(messages, true)[0]);
    expect(latest.type === 'tool_call' && latest.content.call_id).toBe('first');
    expect(getActivityTools(latest)[0].input).toContain('first.md');
    expect(getActivityTools(latest)[0].output).toBe('Read successfully');
    vi.restoreAllMocks();
  });

  it('retains all reasoning chunks and completion metadata with the original row identity', () => {
    const first = frame('thinking', { content: 'Check ' });
    let messages = composeMessage(first, []);
    messages = composeMessage(frame('thinking', { content: 'requirements' }), messages);
    messages = composeMessage(frame('thinking', { content: '', status: 'done', duration_ms: 123 }), messages);
    const row = summaries(messages)[0];
    expect(row.sourceMessageIds).toEqual([first.id]);
    expect(row.messages[0].type === 'thinking' && row.messages[0].content.content).toBe('Check requirements');
    expect(row.messages[0].type === 'thinking' && row.messages[0].content.status).toBe('done');
  });
});

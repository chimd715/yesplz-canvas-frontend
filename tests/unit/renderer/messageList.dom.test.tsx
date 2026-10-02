/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { type PropsWithChildren } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessageAcpToolCall, IMessageText, IMessageToolGroup, TMessage } from '@/common/chat/chatLib';
import type { MessageFileChangesProps } from '@/renderer/pages/conversation/Messages/MessageFileChanges';
import {
  MessageListLoadingProvider,
  MessageListProvider,
  MessagePaginationProvider,
  useUpdateMessageList,
} from '@/renderer/pages/conversation/Messages/hooks';
import MessageList from '@/renderer/pages/conversation/Messages/MessageList';
import { dispatchChatMessageJump } from '@/renderer/utils/chat/chatMinimapEvents';

const { parseDiffMock, useTeamPermissionMock, emptyArtifacts } = vi.hoisted(() => ({
  parseDiffMock: vi.fn(),
  useTeamPermissionMock: vi.fn(),
  emptyArtifacts: [],
}));

const navigation = vi.hoisted(() => ({
  direction: null as 'up' | 'down' | null,
  atTop: false,
  atBottom: false,
  jumping: false,
  jump: vi.fn(),
  next: vi.fn(),
  previous: vi.fn(),
  anchor: vi.fn(),
  top: vi.fn(),
  bottom: vi.fn(),
  scrollElementIntoView: vi.fn(),
  hideScrollButton: vi.fn(),
  location: { key: 'location-key', state: {} as { targetMessageId?: string } },
  scope: {
    current: {
      conversationId: 'conversation-1',
      epoch: 0,
      active: true,
      window: 'latest' as 'latest' | 'first' | 'anchor',
    },
  },
}));
vi.mock('@/renderer/pages/conversation/Messages/historyNavigation', () => ({
  useHistoryNavigation: () => ({
    jump: navigation.jump,
    loadNextPage: navigation.next,
    isJumping: navigation.jumping,
    isLoadingAfter: false,
    isBusy: () => navigation.jumping,
    requestScope: navigation.scope,
  }),
}));
vi.mock('@/renderer/pages/conversation/Messages/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/renderer/pages/conversation/Messages/hooks')>()),
  useLoadPreviousMessagePage: () => navigation.previous,
  useLoadAnchorMessageWindow: () => navigation.anchor,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => navigation.location,
}));

vi.mock('@arco-design/web-react', () => ({
  Button: ({
    children,
    long: _long,
    type: _type,
    size: _size,
    loading: _loading,
    ...props
  }: React.PropsWithChildren<Record<string, unknown>>) => (
    <button type='button' {...props}>
      {children}
    </button>
  ),
  Spin: () => <span role='progressbar' />,
  Message: { error: vi.fn() },
  Image: {
    PreviewGroup: ({ children }: PropsWithChildren) => <>{children}</>,
  },
}));

vi.mock('@/renderer/hooks/context/ConversationContext', () => ({
  useConversationContextSafe: () => ({ conversation_id: 'conversation-1', type: 'aionrs' }),
}));

vi.mock('@/renderer/pages/team/hooks/TeamPermissionContext', () => ({
  useTeamPermission: useTeamPermissionMock,
}));

let mockIsProcessing = false;
vi.mock('@/renderer/pages/conversation/runtime/useConversationRuntimeView', () => ({
  useConversationRuntimeView: () => ({ isProcessing: mockIsProcessing }),
}));

vi.mock('@/renderer/pages/conversation/Messages/artifacts', () => ({
  useConversationArtifacts: () => emptyArtifacts,
}));

vi.mock('@/renderer/pages/conversation/Messages/useAutoScroll', () => ({
  useAutoScroll: () => ({
    handleScrollerRef: () => {},
    handleContentRef: () => {},
    handleScroll: () => {},
    handleWheel: () => {},
    handlePointerDown: () => {},
    showScrollButton: false,
    scrollDirection: navigation.direction,
    atTop: navigation.atTop,
    atBottom: navigation.atBottom,
    scrollToTop: navigation.top,
    scrollToBottom: navigation.bottom,
    scrollElementIntoView: navigation.scrollElementIntoView,
    hideScrollButton: navigation.hideScrollButton,
  }),
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageText', () => ({
  default: ({ message, showCopyRow }: { message: IMessageText; showCopyRow?: boolean }) => (
    <div data-testid={`msgtext-${message.id}`} data-copy-row={String(showCopyRow ?? true)}>
      {message.content.content}
    </div>
  ),
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageTips', () => ({
  default: () => <div>tips</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageToolCall', () => ({
  default: () => <div>tool_call</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageToolGroup', () => ({
  default: ({ message }: { message: IMessageToolGroup }) => (
    <div data-testid='tool-group' data-message-id={message.id}>
      tool_group
    </div>
  ),
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageAgentStatus', () => ({
  default: () => <div>agent_status</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessagePermission', () => ({
  default: () => <div>permission</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/acp/MessageAcpPermission', () => ({
  default: () => <div>acp_permission</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/acp/MessageAcpToolCall', () => ({
  default: ({ message }: { message: IMessageAcpToolCall }) => (
    <div
      data-testid='acp-tool-call'
      data-message-id={message.id}
      data-diff-count={message.content.update.content?.filter((item) => item.type === 'diff').length ?? 0}
    >
      acp_tool_call
    </div>
  ),
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessagePlan', () => ({
  default: () => <div>plan</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageThinking', () => ({
  default: () => <div>thinking</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageCronTrigger', () => ({
  default: () => <div>cron_trigger</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageSkillSuggest', () => ({
  default: () => <div>skill_suggest</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageToolGroupSummary', () => ({
  default: ({ messages }: { messages: Array<IMessageToolGroup | IMessageAcpToolCall> }) => (
    <div data-testid='tool-summary'>{messages.map((message) => message.id).join(',')}</div>
  ),
}));

vi.mock('@/renderer/pages/conversation/Messages/MessageFileChanges', () => ({
  __esModule: true,
  default: ({ diffsChanges }: MessageFileChangesProps) => (
    <div data-testid='file-changes' data-file-count={diffsChanges?.length ?? 0}>
      file_changes
    </div>
  ),
  parseDiff: parseDiffMock,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/SelectionReplyButton', () => ({
  default: () => null,
}));

vi.mock('@icon-park/react', () => ({
  Down: () => <span>down</span>,
  Right: () => <span>right</span>,
  CheckOne: () => <span>done</span>,
  CloseOne: () => <span>failed</span>,
  Up: () => <span>up</span>,
}));

function createTextMessage(): IMessageText {
  return {
    id: 'message-1',
    msg_id: 'msg-1',
    conversation_id: 'conversation-1',
    type: 'text',
    position: 'left',
    content: {
      content: 'streaming reply',
    },
    created_at: 1,
  };
}

type AcpToolCallOptions = {
  id?: string;
  status?: IMessageAcpToolCall['content']['update']['status'];
  content?: IMessageAcpToolCall['content']['update']['content'];
  truncated?: boolean;
};

function createAcpToolCall({
  id = 'acp-edit-1',
  status = 'completed',
  content,
  truncated = false,
}: AcpToolCallOptions = {}): IMessageAcpToolCall {
  return {
    id,
    msg_id: id,
    conversation_id: 'conversation-1',
    type: 'acp_tool_call',
    position: 'left',
    content: {
      session_id: 'session-1',
      ...(truncated
        ? {
            _compact: {
              truncated: true,
              original_size: 90000,
              preview_chars: 4096,
            },
          }
        : {}),
      update: {
        sessionUpdate: 'tool_call_update',
        tool_call_id: id,
        status,
        title: 'Edit file',
        kind: 'edit',
        content,
      },
    },
    created_at: 2,
  } as IMessageAcpToolCall;
}

function createToolGroup(content: IMessageToolGroup['content'], id = 'tool-group-1'): IMessageToolGroup {
  return {
    id,
    msg_id: id,
    conversation_id: 'conversation-1',
    type: 'tool_group',
    position: 'left',
    content,
    created_at: 2,
  };
}

function Wrapper({
  children,
  messages = [createTextMessage()],
  loading = false,
  hasMoreBefore = false,
  hasMoreAfter = false,
}: PropsWithChildren<{
  messages?: TMessage[];
  loading?: boolean;
  hasMoreBefore?: boolean;
  hasMoreAfter?: boolean;
}>): JSX.Element {
  return (
    <MessageListLoadingProvider value={loading}>
      <MessagePaginationProvider
        value={{ hasMoreBefore, hasMoreAfter, isLoadingBefore: false, isLoadingAnchor: false }}
      >
        <MessageListProvider value={messages}>{children}</MessageListProvider>
      </MessagePaginationProvider>
    </MessageListLoadingProvider>
  );
}

function ReplaceMessagesButton({ messages }: { messages: TMessage[] }): JSX.Element {
  const updateMessages = useUpdateMessageList();
  return <button onClick={() => updateMessages(messages)}>replace messages</button>;
}

function AnchorMessagesLoader({ messages, request }: { messages: TMessage[]; request: Promise<boolean> }): null {
  const updateMessages = useUpdateMessageList();
  React.useEffect(() => {
    navigation.anchor.mockImplementation(() => {
      ++navigation.scope.current.epoch;
      navigation.scope.current.window = 'anchor';
      return request.then((loaded) => {
        if (loaded) updateMessages(messages);
        return loaded;
      });
    });
  }, [messages, request, updateMessages]);
  return null;
}

describe('MessageList', () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    mockIsProcessing = false;
    parseDiffMock.mockReset();
    parseDiffMock.mockReturnValue({
      file_name: 'file.ts',
      fullPath: '/workspace/file.ts',
      insertions: 1,
      deletions: 1,
      diff: 'diff',
    });
    useTeamPermissionMock.mockReturnValue(null);
  });

  it('renders one retained activity row per customer turn while leaving answer text in the stream', () => {
    vi.stubGlobal('electronAPI', undefined);
    const messages = [
      {
        id: 'user-1',
        type: 'text',
        position: 'right',
        conversation_id: 'conversation-1',
        created_at: 1,
        content: { content: 'Build it' },
      },
      {
        id: 'think-1',
        type: 'thinking',
        msg_id: 'minted-thinking-1',
        conversation_id: 'conversation-1',
        created_at: 2,
        content: { content: 'Inspect the requirements', status: 'done' },
      },
      {
        id: 'answer-1',
        type: 'text',
        position: 'left',
        msg_id: 'minted-text-1',
        conversation_id: 'conversation-1',
        created_at: 3,
        content: { content: 'First result' },
      },
      {
        id: 'tool-1',
        type: 'tool_call',
        msg_id: 'aionrs-read-1',
        conversation_id: 'conversation-1',
        created_at: 4,
        content: { call_id: 'read-1', name: 'Read', args: {}, status: 'completed', output: 'Checked file' },
      },
      {
        id: 'answer-2',
        type: 'text',
        position: 'left',
        msg_id: 'minted-text-2',
        conversation_id: 'conversation-1',
        created_at: 5,
        content: { content: 'Final result' },
      },
    ] as TMessage[];
    render(
      <Wrapper messages={messages}>
        <MessageList />
      </Wrapper>
    );
    expect(screen.getAllByTestId('turn-activity')).toHaveLength(1);
    expect(screen.getByText('First result')).toBeInTheDocument();
    expect(screen.getByText('Final result')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'messages.activity.show' }));
    expect(screen.getByText('Inspect the requirements')).toBeInTheDocument();
    expect(screen.getByText('Checked file')).toBeInTheDocument();
  });

  it('keeps question and secret tool data out of the customer activity and history', () => {
    vi.stubGlobal('electronAPI', undefined);
    const messages = ['AskUserQuestion', 'request_secret'].map((name, index) => ({
      id: `private-${index}`,
      type: 'tool_call',
      msg_id: 'native-turn',
      conversation_id: 'conversation-1',
      created_at: 1,
      content: {
        call_id: `private-call-${index}`,
        name,
        args: { text: 'Private input' },
        output: 'Private output',
        status: 'completed',
      },
    })) as TMessage[];
    render(
      <Wrapper messages={messages}>
        <MessageList emptySlot={<div>Customer chat</div>} />
      </Wrapper>
    );
    expect(screen.queryByTestId('turn-activity')).not.toBeInTheDocument();
    expect(screen.getByText('Customer chat')).toBeInTheDocument();
    expect(screen.queryByText('Private output')).not.toBeInTheDocument();
  });

  it('keeps an earlier customer history turn finished while a different live turn is processing', () => {
    vi.stubGlobal('electronAPI', undefined);
    mockIsProcessing = true;
    const messages = [
      {
        id: 'historic-thinking',
        type: 'thinking',
        msg_id: 'historic-segment',
        conversation_id: 'conversation-1',
        created_at: 1,
        content: { content: 'Earlier reasoning', status: 'done' },
      },
    ] as TMessage[];
    render(
      <Wrapper messages={messages} hasMoreAfter>
        <MessageList />
      </Wrapper>
    );
    expect(screen.getByRole('button', { name: 'messages.activity.show' })).toHaveTextContent(
      'messages.activity.completed'
    );
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'messages.activity.show' }));
    expect(screen.getByText('Earlier reasoning')).toBeInTheDocument();
  });

  it('keeps customer activity expanded when live user and activity row IDs are replaced by persisted IDs', () => {
    vi.stubGlobal('electronAPI', undefined);
    const messages: TMessage[] = [
      {
        id: 'live-user-uuid',
        msg_id: 'logical-user-1',
        type: 'text',
        position: 'right',
        conversation_id: 'conversation-1',
        created_at: 1,
        content: { content: 'Build it' },
      },
      {
        id: 'live-thinking-uuid',
        msg_id: 'logical-thinking-1',
        type: 'thinking',
        conversation_id: 'conversation-1',
        created_at: 2,
        content: { content: 'Retained reasoning', status: 'done' },
      },
    ];
    const persisted = messages.map((message, index) => ({ ...message, id: `persisted-${index}` }));
    render(
      <Wrapper messages={messages}>
        <MessageList />
        <ReplaceMessagesButton messages={persisted} />
      </Wrapper>
    );
    const button = screen.getByRole('button', { name: 'messages.activity.show' });
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'replace messages' }));
    expect(screen.getByRole('button', { name: 'messages.activity.hide' })).toBe(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Retained reasoning')).toBeInTheDocument();
  });

  it('preserves the native browser Team tool summary instead of adding a customer activity status', () => {
    vi.stubGlobal('electronAPI', undefined);
    useTeamPermissionMock.mockReturnValue({ isTeamMode: true });
    const toolGroup = createToolGroup([
      {
        call_id: 'team-call',
        name: 'Read',
        status: 'Success',
        description: 'Read file',
        render_output_as_markdown: false,
      },
    ]);
    render(
      <Wrapper messages={[toolGroup]}>
        <MessageList />
      </Wrapper>
    );
    expect(screen.getByTestId('tool-summary')).toBeInTheDocument();
    expect(screen.queryByTestId('turn-activity')).not.toBeInTheDocument();
  });

  it('preserves the native desktop tool summary', () => {
    const toolGroup = createToolGroup([
      {
        call_id: 'desktop-call',
        name: 'Read',
        status: 'Success',
        description: 'Read file',
        render_output_as_markdown: false,
      },
    ]);
    render(
      <Wrapper messages={[toolGroup]}>
        <MessageList />
      </Wrapper>
    );
    expect(screen.getByTestId('tool-summary')).toBeInTheDocument();
    expect(screen.queryByTestId('turn-activity')).not.toBeInTheDocument();
  });

  it('never renders a plan as a stream row (it belongs to ConversationPlanBar)', () => {
    // A plan is a replaceable snapshot pinned above the send box, not a message.
    // Filtered rather than rendered as null: a null row still occupies a slot.
    render(
      <>
        <MessageList />
        <ReplaceMessagesButton
          messages={[
            {
              id: 'text-before',
              msg_id: 'turn-a',
              conversation_id: 'conversation-1',
              type: 'text',
              position: 'left',
              created_at: 1,
              content: { content: 'before the plan' },
            } as TMessage,
            {
              id: 'plan:turn-a',
              msg_id: 'turn-a',
              conversation_id: 'conversation-1',
              type: 'plan',
              position: 'left',
              created_at: 2,
              content: { entries: [{ content: 'PLAN_ENTRY_MARKER', status: 'pending' }] },
            } as TMessage,
            {
              id: 'text-after',
              msg_id: 'turn-b',
              conversation_id: 'conversation-1',
              type: 'text',
              position: 'left',
              created_at: 3,
              content: { content: 'after the plan' },
            } as TMessage,
          ]}
        />
      </>,
      { wrapper: ({ children }) => <Wrapper>{children}</Wrapper> }
    );

    fireEvent.click(screen.getByText('replace messages'));

    // Assert on the ROW, not on rendered entry text: this file stubs the message
    // components, so entry text would be absent either way and the test would
    // pass against the unfixed code.
    const content = screen.getByTestId('message-list-content');
    expect(content.querySelectorAll('[data-message-type="plan"]')).toHaveLength(0);
    expect(content.querySelectorAll('[data-message-type="text"]')).toHaveLength(2);
    expect(screen.getByText('before the plan')).toBeInTheDocument();
    expect(screen.getByText('after the plan')).toBeInTheDocument();
  });

  it('renders message rows with external margin spacing in the plain scroll list', () => {
    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper>{children}</Wrapper>,
    });

    expect(screen.getByTestId('message-list-scroller')).toBeInTheDocument();
    expect(screen.getByTestId('message-list-content')).toBeInTheDocument();

    const messageRow = screen.getByTestId('message-text-left');
    expect(messageRow.className).toContain('m-t-10px');
    expect(messageRow.className).not.toContain('pt-10px');
  });

  it('uses container-responsive fluid width for standalone message rows', () => {
    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper>{children}</Wrapper>,
    });

    const messageRow = screen.getByTestId('message-text-left');
    expect(messageRow.className).toContain('chat-surface-fluid');
    expect(messageRow.className).not.toContain('w-[calc(100%-24px)]');
    expect(messageRow.className).not.toContain('md:w-[calc(100%-clamp(80px,10vw,240px))]');
    expect(messageRow.className).not.toContain('max-w-780px');
  });

  it('uses the same container-responsive width in team mode', () => {
    // Team and standalone rows share one class. Width is decided by the column the
    // rows are given, not by the mode: `.chat-surface-fluid` is full-width until
    // its container passes the gutter threshold. A team parallel column (~400px)
    // therefore still renders full width, while team single view — which fills the
    // chat area — gets the same gutters as a standalone conversation, leaving room
    // for the anchor rail instead of crowding the text.
    useTeamPermissionMock.mockReturnValue({
      isTeamMode: true,
      isLeaderAgent: true,
      leaderConversationId: 'conversation-1',
      allConversationIds: ['conversation-1'],
      propagateMode: vi.fn(),
      warmupSession: vi.fn().mockResolvedValue(undefined),
    });

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper>{children}</Wrapper>,
    });

    const messageRow = screen.getByTestId('message-text-left');
    expect(messageRow.className).toContain('chat-surface-fluid');
    // No hardcoded viewport-based widths: the container query owns the breakpoint.
    expect(messageRow.className).not.toContain('w-[calc(100%-24px)]');
    expect(messageRow.className).not.toContain('md:w-[calc(100%-clamp(80px,10vw,240px))]');
  });

  it('shows the copy row only on the last AI text of each turn', () => {
    // Turn 1: thinking + text(a) + tool + text(b) -> row only on text(b).
    // A user message ends the turn. Turn 2: text(c) -> row on text(c).
    const messages = [
      { id: 'think-1', type: 'thinking', position: 'left', content: { content: 'thinking' }, created_at: 1 },
      { id: 'text-a', type: 'text', position: 'left', content: { content: 'a' }, created_at: 2 },
      { id: 'tool-1', type: 'tool_call', position: 'left', content: { content: 't' }, created_at: 3 },
      { id: 'text-b', type: 'text', position: 'left', content: { content: 'b' }, created_at: 4 },
      { id: 'user-1', type: 'text', position: 'right', content: { content: 'q' }, created_at: 5 },
      { id: 'text-c', type: 'text', position: 'left', content: { content: 'c' }, created_at: 6 },
    ] as unknown as IMessageText[];

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={messages}>{children}</Wrapper>,
    });

    // Intermediate AI text (followed by a tool then another text) hides the row.
    expect(screen.getByTestId('msgtext-text-a').getAttribute('data-copy-row')).toBe('false');
    // Last AI text of turn 1 (after the tool block) keeps the row — fallback strategy.
    expect(screen.getByTestId('msgtext-text-b').getAttribute('data-copy-row')).toBe('true');
    // User message always keeps its own row.
    expect(screen.getByTestId('msgtext-user-1').getAttribute('data-copy-row')).toBe('true');
    // Turn 2's only/last text keeps the row.
    expect(screen.getByTestId('msgtext-text-c').getAttribute('data-copy-row')).toBe('true');
  });

  it('withholds the streaming turn copy row but keeps earlier finished turns', () => {
    mockIsProcessing = true;
    // Turn 1 finished (text-a), then a user message, then turn 2 still streaming (text-b).
    const messages = [
      { id: 'text-a', type: 'text', position: 'left', content: { content: 'a' }, created_at: 1 },
      { id: 'user-1', type: 'text', position: 'right', content: { content: 'q' }, created_at: 2 },
      { id: 'text-b', type: 'text', position: 'left', content: { content: 'b' }, created_at: 3 },
    ] as unknown as IMessageText[];

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={messages}>{children}</Wrapper>,
    });

    // Earlier finished turn keeps its row even while a later turn streams.
    expect(screen.getByTestId('msgtext-text-a').getAttribute('data-copy-row')).toBe('true');
    // The in-progress final turn withholds its row until streaming ends.
    expect(screen.getByTestId('msgtext-text-b').getAttribute('data-copy-row')).toBe('false');
  });

  it('renders the empty slot when there are no messages', () => {
    render(<MessageList emptySlot={<div>empty state</div>} />, {
      wrapper: ({ children }) => <Wrapper messages={[]}>{children}</Wrapper>,
    });

    expect(screen.getByText('empty state')).toBeInTheDocument();
  });

  it('renders a skeleton while the initial message batch is loading', () => {
    render(<MessageList emptySlot={<div>empty state</div>} />, {
      wrapper: ({ children }) => (
        <Wrapper messages={[]} loading>
          {children}
        </Wrapper>
      ),
    });

    expect(screen.getByTestId('message-list-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('empty state')).not.toBeInTheDocument();
  });

  it('renders complete ACP diffs through the specialized file-change message', () => {
    const message = createAcpToolCall({
      content: [
        { type: 'content', content: { type: 'text', text: 'updated both files' } },
        { type: 'diff', path: '/workspace/a.ts', old_text: 'old a', new_text: 'new a' },
        { type: 'diff', path: '/workspace/b.ts', old_text: 'old b', new_text: 'new b' },
      ],
    });

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={[message]}>{children}</Wrapper>,
    });

    expect(screen.getByTestId('acp-tool-call')).toHaveAttribute('data-diff-count', '2');
    expect(screen.queryByTestId('tool-summary')).not.toBeInTheDocument();
  });

  it('renders a newly created file when only new text is present', () => {
    const message = createAcpToolCall({
      content: [{ type: 'diff', path: '/workspace/new-file.ts', new_text: 'export const created = true;' }],
    });

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={[message]}>{children}</Wrapper>,
    });

    expect(screen.getByTestId('acp-tool-call')).toHaveAttribute('data-diff-count', '1');
    expect(screen.queryByTestId('tool-summary')).not.toBeInTheDocument();
  });

  it('keeps ACP calls without diffs in View Steps', () => {
    const message = createAcpToolCall({
      id: 'acp-read-1',
      content: [{ type: 'content', content: { type: 'text', text: 'file contents' } }],
    });

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={[message]}>{children}</Wrapper>,
    });

    expect(screen.getByTestId('tool-summary')).toHaveTextContent('acp-read-1');
    expect(screen.queryByTestId('acp-tool-call')).not.toBeInTheDocument();
  });

  it('keeps malformed ACP diffs in View Steps instead of showing misleading stats', () => {
    const message = createAcpToolCall({
      content: [
        { type: 'diff', path: '/workspace/valid.ts', old_text: 'old', new_text: 'new' },
        null,
        { type: 'diff', new_text: 'missing path' },
      ] as unknown as IMessageAcpToolCall['content']['update']['content'],
    });

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={[message]}>{children}</Wrapper>,
    });

    expect(screen.getByTestId('tool-summary')).toHaveTextContent(message.id);
    expect(screen.queryByTestId('acp-tool-call')).not.toBeInTheDocument();
  });

  it('keeps an ACP message without an update in View Steps', () => {
    const message = {
      ...createAcpToolCall({ id: 'acp-missing-update' }),
      content: { session_id: 'session-1' },
    } as unknown as IMessageAcpToolCall;

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={[message]}>{children}</Wrapper>,
    });

    expect(screen.getByTestId('tool-summary')).toHaveTextContent(message.id);
    expect(screen.queryByTestId('acp-tool-call')).not.toBeInTheDocument();
  });

  it('keeps truncated ACP diffs in View Steps instead of calculating stats from the preview', () => {
    const message = createAcpToolCall({
      truncated: true,
      content: [{ type: 'diff', path: '/workspace/file.ts', old_text: 'partial old', new_text: 'partial new' }],
    });

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={[message]}>{children}</Wrapper>,
    });

    expect(screen.getByTestId('tool-summary')).toHaveTextContent(message.id);
    expect(screen.queryByTestId('acp-tool-call')).not.toBeInTheDocument();
  });

  it('switches a running tool from View Steps when its completed update adds a diff', () => {
    const runningMessage = createAcpToolCall({ status: 'in_progress' });
    const completedMessage = createAcpToolCall({
      content: [{ type: 'diff', path: '/workspace/file.ts', old_text: 'old', new_text: 'new' }],
    });
    render(
      <Wrapper messages={[runningMessage]}>
        <MessageList />
        <ReplaceMessagesButton messages={[completedMessage]} />
      </Wrapper>
    );

    expect(screen.getByTestId('tool-summary')).toHaveTextContent(runningMessage.id);

    fireEvent.click(screen.getByText('replace messages'));

    expect(screen.getByTestId('acp-tool-call')).toHaveAttribute('data-message-id', completedMessage.id);
    expect(screen.queryByTestId('tool-summary')).not.toBeInTheDocument();
  });

  it('preserves surrounding tool summaries when an ACP edit contains multiple diffs', () => {
    const readMessage = createAcpToolCall({ id: 'acp-read-1' });
    const editMessage = createAcpToolCall({
      id: 'acp-edit-1',
      content: [
        { type: 'diff', path: '/workspace/a.ts', old_text: 'old a', new_text: 'new a' },
        { type: 'diff', path: '/workspace/b.ts', old_text: 'old b', new_text: 'new b' },
      ],
    });
    const executeMessage = createAcpToolCall({ id: 'acp-execute-1' });

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={[readMessage, editMessage, executeMessage]}>{children}</Wrapper>,
    });

    expect(screen.getByTestId('acp-tool-call')).toHaveAttribute('data-diff-count', '2');
    expect(screen.getAllByTestId('tool-summary')).toHaveLength(2);
    expect(screen.getAllByTestId('tool-summary').map((item) => item.textContent)).toEqual([
      'acp-read-1',
      'acp-execute-1',
    ]);
  });

  it('preserves the legacy single WriteFile summary path', () => {
    const message = createToolGroup([
      {
        call_id: 'write-1',
        description: 'Write file',
        name: 'WriteFile',
        render_output_as_markdown: false,
        result_display: {
          file_diff: 'diff --git a/file.ts b/file.ts\n-old\n+new',
          file_name: '/workspace/file.ts',
        },
        status: 'Success',
      },
    ]);

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={[message]}>{children}</Wrapper>,
    });

    expect(screen.getByTestId('file-changes')).toHaveAttribute('data-file-count', '1');
    expect(parseDiffMock).toHaveBeenCalledWith('diff --git a/file.ts b/file.ts\n-old\n+new', '/workspace/file.ts');
    expect(screen.queryByTestId('tool-summary')).not.toBeInTheDocument();
  });

  it('aggregates legacy groups containing only structured WriteFile results', () => {
    const message = createToolGroup([
      {
        call_id: 'write-1',
        description: 'Write file',
        name: 'WriteFile',
        render_output_as_markdown: false,
        result_display: {
          file_diff: 'diff --git a/file.ts b/file.ts\n-old\n+new',
          file_name: '/workspace/file.ts',
        },
        status: 'Success',
      },
      {
        call_id: 'write-2',
        description: 'Write second file',
        name: 'WriteFile',
        render_output_as_markdown: false,
        result_display: {
          file_diff: 'diff --git a/second.ts b/second.ts\n-old\n+new',
          file_name: '/workspace/second.ts',
        },
        status: 'Success',
      },
    ]);

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={[message]}>{children}</Wrapper>,
    });

    expect(screen.getByTestId('file-changes')).toHaveAttribute('data-file-count', '2');
    expect(parseDiffMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('tool-summary')).not.toBeInTheDocument();
  });

  it('keeps mixed legacy tool groups in View Steps without dropping non-file tools', () => {
    const message = createToolGroup([
      {
        call_id: 'write-1',
        description: 'Write file',
        name: 'WriteFile',
        render_output_as_markdown: false,
        result_display: {
          file_diff: 'diff --git a/file.ts b/file.ts\n-old\n+new',
          file_name: '/workspace/file.ts',
        },
        status: 'Success',
      },
      {
        call_id: 'read-1',
        description: 'Read file',
        name: 'ReadFile',
        render_output_as_markdown: false,
        result_display: 'done',
        status: 'Success',
      },
    ]);

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={[message]}>{children}</Wrapper>,
    });

    expect(screen.getByTestId('tool-summary')).toHaveTextContent(message.id);
    expect(screen.queryByTestId('file-changes')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tool-group')).not.toBeInTheDocument();
  });
});

describe('directional history controls', () => {
  const frames: FrameRequestCallback[] = [];
  beforeEach(() => {
    vi.clearAllMocks();
    navigation.direction = null;
    navigation.atTop = false;
    navigation.atBottom = false;
    navigation.jumping = false;
    navigation.scope.current.epoch = 0;
    navigation.scope.current.active = true;
    navigation.scope.current.window = 'latest';
    navigation.location = { key: 'location-key', state: {} };
    navigation.anchor.mockReset().mockResolvedValue(false);
    navigation.jump.mockImplementation(async (endpoint: 'first' | 'latest') => {
      ++navigation.scope.current.epoch;
      navigation.scope.current.window = endpoint;
      return true;
    });
    navigation.previous.mockImplementation(async () => {
      ++navigation.scope.current.epoch;
      return true;
    });
    navigation.next.mockResolvedValue(true);
    frames.length = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    navigation.direction = null;
    navigation.location = { key: 'location-key', state: {} };
  });
  const flushFrames = () =>
    act(() => {
      while (frames.length) frames.shift()!(0);
    });
  const mountNavigation = (before = false, after = false) =>
    render(
      <Wrapper hasMoreBefore={before} hasMoreAfter={after}>
        <MessageList />
      </Wrapper>
    );
  const metrics = (top: number, height = 1000, client = 400) => {
    const scroller = screen.getByTestId('message-list-scroller');
    Object.defineProperties(scroller, {
      scrollTop: { value: top, writable: true, configurable: true },
      scrollHeight: { value: height, configurable: true },
      clientHeight: { value: client, configurable: true },
    });
    return scroller;
  };

  it('offers the up or down endpoint for current direction and hides each at its true boundary', () => {
    navigation.direction = 'up';
    navigation.atTop = true;
    const view = mountNavigation();
    expect(screen.queryByTestId('history-jump-first')).toBeNull();
    navigation.atTop = false;
    view.rerender(
      <Wrapper>
        <MessageList />
      </Wrapper>
    );
    expect(screen.getByRole('button', { name: 'messages.scrollToTop' })).toBeInTheDocument();
    navigation.direction = 'down';
    view.rerender(
      <Wrapper>
        <MessageList />
      </Wrapper>
    );
    expect(screen.getByRole('button', { name: 'messages.scrollToBottom' })).toBeInTheDocument();
    navigation.atBottom = true;
    view.rerender(
      <Wrapper>
        <MessageList />
      </Wrapper>
    );
    expect(screen.queryByTestId('history-jump-latest')).toBeNull();
  });

  it('jumps after its single endpoint request and discards a deferred scroll if a newer request owns the window', async () => {
    navigation.direction = 'up';
    mountNavigation(true);
    await act(async () => fireEvent.click(screen.getByTestId('history-jump-first')));
    expect(navigation.jump).toHaveBeenCalledWith('first');
    ++navigation.scope.current.epoch;
    flushFrames();
    expect(navigation.top).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByTestId('history-jump-first')));
    flushFrames();
    expect(navigation.top).toHaveBeenCalledOnce();
  });

  it('uses this scrollbar movement instead of the previous rendered direction', () => {
    navigation.direction = 'up';
    mountNavigation(false, true);
    const scroller = metrics(590);
    fireEvent.scroll(scroller);
    expect(navigation.next).toHaveBeenCalledOnce();
    expect(navigation.previous).not.toHaveBeenCalled();
  });

  it('advances a short first page from wheel intent even if no scroll event can fire', () => {
    navigation.direction = 'up';
    mountNavigation(false, true);
    const scroller = metrics(0, 300, 400);
    fireEvent.wheel(scroller, { deltaY: 20 });
    expect(navigation.next).toHaveBeenCalledOnce();
  });

  it('does not apply an obsolete predecessor-page height correction after an endpoint jump', async () => {
    navigation.direction = 'up';
    mountNavigation(true);
    const scroller = metrics(300);
    fireEvent.scroll(scroller);
    const content = screen.getByTestId('message-list-content');
    Object.defineProperty(content, 'scrollHeight', { value: 1000, writable: true, configurable: true });
    scroller.scrollTop = 30;
    await act(async () => fireEvent.scroll(scroller));
    Object.defineProperty(content, 'scrollHeight', { value: 2000, writable: true, configurable: true });
    expect(navigation.previous).toHaveBeenCalledOnce();
    await act(async () => fireEvent.click(screen.getByTestId('history-jump-first')));
    flushFrames();
    expect(scroller.scrollTop).toBe(30);
    expect(navigation.top).toHaveBeenCalledOnce();
  });

  it('does not scroll to a loaded message when an endpoint supersedes its queued jump event', async () => {
    navigation.direction = 'up';
    mountNavigation(true);
    act(() => dispatchChatMessageJump({ conversation_id: 'conversation-1', messageId: 'message-1' }));
    expect(frames).toHaveLength(1);
    await act(async () => fireEvent.click(screen.getByTestId('history-jump-first')));
    flushFrames();
    expect(navigation.scrollElementIntoView).not.toHaveBeenCalled();
    expect(navigation.top).toHaveBeenCalledOnce();
  });

  it('accepts a loaded message jump after the router location changes within the same conversation', () => {
    const view = mountNavigation();
    navigation.location = { key: 'reopened-conversation', state: {} };
    view.rerender(
      <Wrapper>
        <MessageList />
      </Wrapper>
    );
    act(() => dispatchChatMessageJump({ conversation_id: 'conversation-1', messageId: 'message-1' }));
    flushFrames();
    expect(navigation.scrollElementIntoView).toHaveBeenCalledExactlyOnceWith(
      document.getElementById('message-message-1'),
      { block: 'start', behavior: 'smooth' }
    );
  });

  it('scrolls to a fetched anchor after replacing the visible message window', async () => {
    const anchor = { ...createTextMessage(), id: 'missing-anchor', content: { content: 'Fetched anchor' } };
    let resolveAnchor!: (loaded: boolean) => void;
    const request = new Promise<boolean>((resolve) => (resolveAnchor = resolve));
    render(
      <Wrapper>
        <MessageList />
        <AnchorMessagesLoader messages={[anchor]} request={request} />
      </Wrapper>
    );
    act(() =>
      dispatchChatMessageJump({
        conversation_id: 'conversation-1',
        messageId: anchor.id,
        align: 'end',
        behavior: 'auto',
      })
    );
    await act(async () => resolveAnchor(true));
    expect(screen.getByText('Fetched anchor')).toBeInTheDocument();
    expect(navigation.anchor).toHaveBeenCalledExactlyOnceWith(anchor.id);
    flushFrames();
    expect(navigation.scrollElementIntoView).toHaveBeenCalledExactlyOnceWith(
      document.getElementById(`message-${anchor.id}`),
      { block: 'end', behavior: 'auto' }
    );
  });

  it('does not scroll to a fetched anchor when an endpoint supersedes its deferred frames', async () => {
    navigation.direction = 'up';
    const anchor = { ...createTextMessage(), id: 'missing-anchor' };
    let resolveAnchor!: (loaded: boolean) => void;
    const request = new Promise<boolean>((resolve) => (resolveAnchor = resolve));
    render(
      <Wrapper hasMoreBefore>
        <MessageList />
        <AnchorMessagesLoader messages={[anchor]} request={request} />
      </Wrapper>
    );
    act(() => dispatchChatMessageJump({ conversation_id: 'conversation-1', messageId: anchor.id }));
    await act(async () => resolveAnchor(true));
    expect(frames).toHaveLength(1);
    await act(async () => fireEvent.click(screen.getByTestId('history-jump-first')));
    flushFrames();
    expect(navigation.scrollElementIntoView).not.toHaveBeenCalled();
    expect(navigation.top).toHaveBeenCalledOnce();
  });

  it('does not scroll to a fetched anchor after its router location has changed', async () => {
    const anchor = { ...createTextMessage(), id: 'missing-anchor' };
    let resolveAnchor!: (loaded: boolean) => void;
    const request = new Promise<boolean>((resolve) => (resolveAnchor = resolve));
    const view = render(
      <Wrapper>
        <MessageList />
        <AnchorMessagesLoader messages={[anchor]} request={request} />
      </Wrapper>
    );
    act(() => dispatchChatMessageJump({ conversation_id: 'conversation-1', messageId: anchor.id }));
    await act(async () => resolveAnchor(true));
    navigation.location = { key: 'reopened-conversation', state: {} };
    view.rerender(
      <Wrapper>
        <MessageList />
      </Wrapper>
    );
    flushFrames();
    expect(navigation.scrollElementIntoView).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'keeps a location target scroll through a live update unless an endpoint supersedes it (%s)',
    async (superseded) => {
      navigation.direction = 'up';
      navigation.location = { key: 'search-result', state: { targetMessageId: 'message-1' } };
      const liveUpdate = { ...createTextMessage(), content: { content: 'Updated live reply' } };
      render(
        <Wrapper hasMoreBefore>
          <MessageList />
          <ReplaceMessagesButton messages={[liveUpdate]} />
        </Wrapper>
      );
      fireEvent.click(screen.getByRole('button', { name: 'replace messages' }));
      expect(screen.getByText('Updated live reply')).toBeInTheDocument();
      if (superseded) {
        await act(async () => fireEvent.click(screen.getByTestId('history-jump-first')));
      }
      flushFrames();
      if (superseded) {
        expect(navigation.scrollElementIntoView).not.toHaveBeenCalled();
        expect(navigation.top).toHaveBeenCalledOnce();
      } else {
        expect(navigation.scrollElementIntoView).toHaveBeenCalledExactlyOnceWith(
          document.getElementById('message-message-1'),
          { behavior: 'smooth', block: 'center' }
        );
      }
    }
  );
});

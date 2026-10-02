import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import { transformMessage, type TMessage } from '@/common/chat/chatLib';
import { buildMessageIndex, composeMessageWithIndex } from '@/renderer/pages/conversation/Messages/hooks';
import {
  TurnActivity,
  projectTurnActivities,
  type TurnActivitySummary,
} from '@/renderer/pages/conversation/Messages/components/TurnActivity';

const { loadFull } = vi.hoisted(() => ({ loadFull: vi.fn() }));
vi.mock('@/common', () => ({ ipcBridge: { database: { getConversationMessage: { invoke: loadFull } } } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@arco-design/web-react', () => ({
  Button: ({
    children,
    long: _long,
    type: _type,
    size: _size,
    ...props
  }: React.PropsWithChildren<Record<string, unknown>>) => (
    <button type='button' {...props}>
      {children}
    </button>
  ),
  Spin: () => <span role='progressbar' />,
}));

const thinking = (content = 'Check requirements'): TMessage => ({
  id: 'reasoning-1',
  type: 'thinking',
  msg_id: 'assistant-1',
  conversation_id: 'conversation-1',
  created_at: 1,
  content: { content, status: 'thinking' },
});
const tool = (compact = false, id = 'tool-1', conversation = 'conversation-1'): TMessage =>
  ({
    id,
    type: 'tool_call',
    msg_id: 'assistant-1',
    conversation_id: conversation,
    created_at: 2,
    content: {
      call_id: id,
      name: 'Write',
      args: { file_path: 'document.md' },
      status: 'completed',
      output: 'Saved document',
      ...(compact ? { _compact: { truncated: true } } : {}),
    },
  }) as TMessage;
const summary = (messages: TMessage[], active = false): TurnActivitySummary =>
  projectTurnActivities(messages, { isProcessing: active }).find(
    (item): item is TurnActivitySummary => item.type === 'activity_summary'
  )!;
const View = ({ messages, active = false }: { messages: TMessage[]; active?: boolean }) => {
  const value = summary(messages, active);
  return <TurnActivity key={value.id} summary={value} />;
};

describe('compact expandable turn activity', () => {
  beforeEach(() => loadFull.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('updates one collapsed row through actual multi-frame merges, keeping reasoning and tool input after completion', () => {
    let messages: TMessage[] = [];
    const push = (type: IResponseMessage['type'], data: unknown) => {
      const message = transformMessage({
        type,
        data,
        msg_id: 'assistant-1',
        conversation_id: 'conversation-1',
      } as IResponseMessage)!;
      messages = composeMessageWithIndex(message, messages, buildMessageIndex(messages));
    };
    push('thinking', { content: 'Check ' });
    const { rerender } = render(<View messages={messages} active />);
    const button = screen.getByRole('button', { name: 'messages.activity.show' });
    push('thinking', { content: 'requirements' });
    push('tool_call', {
      call_id: 'write-1',
      name: 'Write',
      args: { file_path: 'document.md' },
      input: { file_path: 'document.md' },
      status: 'running',
    });
    rerender(<View messages={messages} active />);
    expect(screen.getAllByTestId('turn-activity')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'messages.activity.show' })).toBe(button);
    expect(button).toHaveTextContent('messages.activity.running · Write');
    push('tool_call', {
      call_id: 'write-1',
      name: 'Write',
      args: null,
      input: undefined,
      status: 'completed',
      output: 'Saved document',
    });
    rerender(<View messages={messages} />);
    expect(button).toHaveTextContent('messages.activity.completed');
    fireEvent.click(button);
    expect(screen.getByText('Check requirements')).toBeInTheDocument();
    expect(screen.getByText(/"file_path": "document.md"/)).toBeInTheDocument();
    expect(screen.getByText('Saved document')).toBeInTheDocument();
  });

  it('preserves expansion across live updates and turn completion; only explicit collapse hides details', () => {
    const { rerender } = render(<View messages={[thinking()]} active />);
    const button = screen.getByRole('button', { name: 'messages.activity.show' });
    fireEvent.click(button);
    rerender(<View messages={[thinking('Check requirements and verify output'), tool()]} active />);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    rerender(<View messages={[thinking('Check requirements and verify output'), tool()]} />);
    expect(screen.getByText('Saved document')).toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.queryByText('Saved document')).not.toBeInTheDocument();
  });

  it('shows completed activity after history reload and retains error output', () => {
    const failed = tool();
    if (failed.type === 'tool_call')
      failed.content = { ...failed.content, status: 'error', output: 'File not writable' };
    render(<View messages={[thinking(), failed]} />);
    const button = screen.getByRole('button', { name: 'messages.activity.show' });
    expect(button).toHaveTextContent('messages.activity.error');
    fireEvent.click(button);
    expect(screen.getByText('File not writable')).toBeInTheDocument();
  });

  it('loads complete compact history only on expansion through the existing scoped API', async () => {
    const full = tool();
    if (full.type === 'tool_call') full.content.output = 'Complete saved document output';
    loadFull.mockResolvedValue(full);
    render(<View messages={[tool(true)]} />);
    expect(loadFull).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'messages.activity.show' }));
    await screen.findByText('Complete saved document output');
    expect(loadFull).toHaveBeenCalledWith({ conversation_id: 'conversation-1', message_id: 'tool-1' });
  });

  it('keeps captured preview available on recovery failure and supports retry', async () => {
    loadFull.mockRejectedValueOnce(new Error('Disconnected')).mockResolvedValueOnce(tool());
    render(<View messages={[tool(true)]} />);
    fireEvent.click(screen.getByRole('button', { name: 'messages.activity.show' }));
    await screen.findByRole('alert');
    expect(screen.getByText('Saved document')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(loadFull).toHaveBeenCalledTimes(2);
  });

  it('rejects mismatched history scope instead of displaying returned activity', async () => {
    const foreign = tool(false, 'tool-1', 'conversation-other');
    if (foreign.type === 'tool_call') foreign.content.output = 'Foreign private output';
    loadFull.mockResolvedValue(foreign);
    render(<View messages={[tool(true)]} />);
    fireEvent.click(screen.getByRole('button', { name: 'messages.activity.show' }));
    await screen.findByRole('alert');
    expect(screen.queryByText('Foreign private output')).not.toBeInTheDocument();
  });

  it('ignores late recovery after a conversation change and resets expanded state', async () => {
    let resolve!: (message: TMessage) => void;
    loadFull.mockReturnValue(
      new Promise<TMessage>((done) => {
        resolve = done;
      })
    );
    const { rerender } = render(<View messages={[tool(true)]} />);
    fireEvent.click(screen.getByRole('button', { name: 'messages.activity.show' }));
    const other = tool(false, 'tool-2', 'conversation-2');
    rerender(<View messages={[other]} />);
    const old = tool();
    if (old.type === 'tool_call') old.content.output = 'Old recovery output';
    await act(async () => resolve(old));
    expect(screen.getByRole('button', { name: 'messages.activity.show' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Old recovery output')).not.toBeInTheDocument();
  });

  it('ignores failed recovery after collapse and retries cleanly on reopening', async () => {
    let reject!: (reason: Error) => void;
    loadFull
      .mockReturnValueOnce(
        new Promise((_resolve, fail) => {
          reject = fail;
        })
      )
      .mockResolvedValueOnce(tool());
    render(<View messages={[tool(true)]} />);
    const button = screen.getByRole('button', { name: 'messages.activity.show' });
    fireEvent.click(button);
    fireEvent.click(button);
    await act(async () => reject(new Error('Late failure')));
    fireEvent.click(button);
    await waitFor(() => expect(loadFull).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

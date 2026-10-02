/** @license Copyright 2025 AionUi (aionui.com) SPDX-License-Identifier: Apache-2.0 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IConfirmation } from '@/common/chat/chatLib';
import QuestionDock from '@/renderer/pages/conversation/Messages/UserQuestions';

type StreamFrame = { conversation_id: string; type: string; data?: unknown };
type RemovalFrame = { conversation_id: string; id: string };
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  answer: vi.fn(),
  stream: [] as Array<(event: StreamFrame) => void>,
  remove: [] as Array<(event: RemovalFrame) => void>,
  reconnect: [] as Array<() => void>,
  auth: { status: 'authenticated', user: { id: 'owner-a' } },
}));
function subscribe<T>(listeners: T[], callback: T) {
  listeners.push(callback);
  return () => {
    const index = listeners.indexOf(callback);
    if (index >= 0) listeners.splice(index, 1);
  };
}
vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      confirmation: {
        list: { invoke: mocks.list },
        remove: { on: (callback: (event: RemovalFrame) => void) => subscribe(mocks.remove, callback) },
      },
      responseStream: { on: (callback: (event: StreamFrame) => void) => subscribe(mocks.stream, callback) },
    },
  },
}));
vi.mock('@/common/adapter/ipcBridge', () => ({
  conversation: { answerAsk: { invoke: mocks.answer } },
  realtime: { reconnected: { on: (callback: () => void) => subscribe(mocks.reconnect, callback) } },
}));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const confirmation = (id = 'ask-a', callId = id): IConfirmation<unknown> => ({
  id,
  call_id: callId,
  description: 'Waiting for answers',
  options: [],
  questions: [{ question: `Question ${callId}?`, options: [{ label: 'Yes' }] }],
});
const emitAsk = (id = 'ask-live', conversationId = 'conversation-a') => {
  for (const listener of mocks.stream)
    listener({
      conversation_id: conversationId,
      type: 'ask',
      data: { session_id: conversationId, request_id: id, questions: confirmation(id).questions },
    });
};

describe('question dock recovery and scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stream.length = 0;
    mocks.remove.length = 0;
    mocks.reconnect.length = 0;
    mocks.auth = { status: 'authenticated', user: { id: 'owner-a' } };
    mocks.list.mockResolvedValue([]);
    mocks.answer.mockResolvedValue(undefined);
  });
  it('recovers only formal questions and removes a recovered request by confirmation id', async () => {
    mocks.list.mockResolvedValue([
      confirmation('confirmation-id', 'request-id'),
      { id: 'permission', call_id: 'tool', description: 'Allow tool', options: [] },
    ]);
    render(<QuestionDock conversationId='conversation-a' />);
    expect(await screen.findByText('Question request-id?')).toBeInTheDocument();
    expect(screen.queryByText('Allow tool')).not.toBeInTheDocument();
    act(() =>
      mocks.remove.forEach((listener) => listener({ conversation_id: 'conversation-a', id: 'confirmation-id' }))
    );
    expect(screen.queryByTestId('message-question')).not.toBeInTheDocument();
  });
  it('receives live questions independently of the history window and advances to the next request', async () => {
    render(<QuestionDock conversationId='conversation-a' />);
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));
    act(() => {
      emitAsk('first');
      emitAsk('second');
      emitAsk('first');
      emitAsk('foreign', 'conversation-b');
    });
    expect(screen.getByText('Question first?')).toBeInTheDocument();
    expect(screen.queryByText('Question second?')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('message-question-decline'));
    expect(await screen.findByText('Question second?')).toBeInTheDocument();
    expect(mocks.answer).toHaveBeenCalledWith({
      conversation_id: 'conversation-a',
      request_id: 'first',
      decline: true,
    });
  });
  it('does not let an older recovery response erase a newer live question', async () => {
    let finish!: (value: IConfirmation<unknown>[]) => void;
    mocks.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    render(<QuestionDock conversationId='conversation-a' />);
    act(() => emitAsk());
    await act(async () => finish([]));
    expect(screen.getByText('Question ask-live?')).toBeInTheDocument();
  });

  it('ignores an older failed recovery after a newer live question arrives', async () => {
    let reject!: (reason: Error) => void;
    mocks.list.mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        })
    );
    render(<QuestionDock conversationId='conversation-a' />);
    act(() => emitAsk('current'));
    await act(async () => reject(new Error('outdated recovery failed')));
    expect(screen.getByText('Question current?')).toBeInTheDocument();
    expect(screen.queryByText('messages.askRecoveryError')).not.toBeInTheDocument();
  });
  it('recovers immediately on a StrictMode restart while the old query is pending', async () => {
    let finishOld!: (value: IConfirmation<unknown>[]) => void;
    mocks.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        })
    );
    mocks.list.mockResolvedValueOnce([confirmation('current')]);
    render(
      <React.StrictMode>
        <QuestionDock conversationId='conversation-a' />
      </React.StrictMode>
    );
    expect(await screen.findByText('Question current?')).toBeInTheDocument();
    expect(mocks.list).toHaveBeenCalledTimes(2);
    await act(async () => finishOld([confirmation('stale')]));
    expect(screen.getByText('Question current?')).toBeInTheDocument();
    expect(screen.queryByText('Question stale?')).not.toBeInTheDocument();
  });
  it('does not release a newer query lock when an obsolete StrictMode query fails', async () => {
    let rejectOld!: (reason: Error) => void;
    let finishCurrent!: (value: IConfirmation<unknown>[]) => void;
    mocks.list.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectOld = reject;
        })
    );
    mocks.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishCurrent = resolve;
        })
    );
    render(
      <React.StrictMode>
        <QuestionDock conversationId='conversation-a' />
      </React.StrictMode>
    );
    expect(mocks.list).toHaveBeenCalledTimes(2);
    await act(async () => rejectOld(new Error('old query failure')));
    act(() => mocks.reconnect.forEach((listener) => listener()));
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('messages.askRecoveryError')).not.toBeInTheDocument();
    await act(async () => finishCurrent([confirmation('current')]));
    expect(screen.getByText('Question current?')).toBeInTheDocument();
    mocks.list.mockResolvedValue([confirmation('reconnected')]);
    await act(async () => mocks.reconnect.forEach((listener) => listener()));
    expect(mocks.list).toHaveBeenCalledTimes(3);
    expect(screen.getByText('Question reconnected?')).toBeInTheDocument();
  });
  it('retries failed recovery and refreshes on WebSocket reconnect', async () => {
    mocks.list.mockRejectedValueOnce(new Error('private server response'));
    render(<QuestionDock conversationId='conversation-a' />);
    expect(await screen.findByText('messages.askRecoveryError')).toBeInTheDocument();
    expect(screen.queryByText('private server response')).not.toBeInTheDocument();
    mocks.list.mockResolvedValue([confirmation()]);
    fireEvent.click(screen.getByText('messages.askRetry'));
    await screen.findByText('Question ask-a?');
    mocks.list.mockResolvedValue([]);
    await act(async () => mocks.reconnect.forEach((listener) => listener()));
    expect(screen.queryByTestId('message-question')).not.toBeInTheDocument();
  });
  it('ignores late recovery from an old scope and clears drafts when account or conversation changes', async () => {
    let finish!: (value: IConfirmation<unknown>[]) => void;
    mocks.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const view = render(<QuestionDock conversationId='conversation-a' />);
    act(() => emitAsk('old'));
    fireEvent.click(screen.getByTestId('message-question-option-0-other'));
    fireEvent.change(screen.getByTestId('message-question-other-input-0'), { target: { value: 'Old scope answer' } });
    view.rerender(<QuestionDock conversationId='conversation-b' />);
    await act(async () => finish([confirmation('old')]));
    expect(screen.queryByText('Question old?')).not.toBeInTheDocument();
    act(() => emitAsk('new', 'conversation-b'));
    expect(screen.getByTestId('message-question-submit')).toBeDisabled();
    mocks.auth = { status: 'authenticated', user: { id: 'owner-b' } };
    view.rerender(<QuestionDock conversationId='conversation-b' />);
    expect(screen.queryByTestId('message-question')).not.toBeInTheDocument();
    mocks.auth.status = 'unauthenticated';
    view.rerender(<QuestionDock conversationId='conversation-b' />);
    expect(mocks.stream).toHaveLength(0);
  });
  it('clears pending questions on finish or error and ignores other conversations', async () => {
    render(<QuestionDock conversationId='conversation-a' />);
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));
    act(() => emitAsk());
    act(() => mocks.stream.forEach((listener) => listener({ conversation_id: 'conversation-b', type: 'finish' })));
    expect(screen.getByTestId('message-question')).toBeInTheDocument();
    act(() => mocks.stream.forEach((listener) => listener({ conversation_id: 'conversation-a', type: 'finish' })));
    expect(screen.queryByTestId('message-question')).not.toBeInTheDocument();
    act(() => emitAsk('next'));
    act(() => mocks.stream.forEach((listener) => listener({ conversation_id: 'conversation-a', type: 'error' })));
    expect(screen.queryByTestId('message-question')).not.toBeInTheDocument();
  });
});

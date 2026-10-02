/** @license Copyright 2025 AionUi (aionui.com) SPDX-License-Identifier: Apache-2.0 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessageAsk } from '@/common/chat/chatLib';
import MessageQuestion from '@/renderer/pages/conversation/Messages/UserQuestions/MessageQuestion';

const { answerAsk } = vi.hoisted(() => ({ answerAsk: vi.fn() }));
vi.mock('@/common/adapter/ipcBridge', () => ({ conversation: { answerAsk: { invoke: answerAsk } } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const message = (conversationId = 'conversation-a', requestId = 'ask-a'): IMessageAsk => ({
  id: requestId,
  conversation_id: conversationId,
  type: 'ask',
  position: 'left',
  content: {
    session_id: conversationId,
    request_id: requestId,
    questions: [
      {
        header: 'Style',
        question: 'Which style?',
        options: [{ label: 'Simple', description: 'A short result' }, { label: 'Detailed' }],
      },
      { question: 'Which sections?', options: [{ label: 'Summary' }, { label: 'Details' }], multiSelect: true },
    ],
  },
});
const advance = () => {
  fireEvent.click(screen.getByTestId('message-question-option-0-Simple'));
  fireEvent.click(screen.getByTestId('message-question-next'));
};
const complete = () => {
  advance();
  fireEvent.click(screen.getByTestId('message-question-option-1-Summary'));
};

describe('sequential customer question form', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    answerAsk.mockResolvedValue(undefined);
  });
  it('shows one question and retains single/multiple/Other drafts across back and next', async () => {
    render(<MessageQuestion message={message()} />);
    expect(screen.getByText('Which style?')).toBeInTheDocument();
    expect(screen.queryByText('Which sections?')).not.toBeInTheDocument();
    expect(screen.getByTestId('message-question-next')).toBeDisabled();
    advance();
    expect(answerAsk).not.toHaveBeenCalled();
    expect(screen.queryByText('Which style?')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('message-question-option-1-Summary'));
    fireEvent.click(screen.getByTestId('message-question-option-1-other'));
    fireEvent.change(screen.getByTestId('message-question-other-input-1'), { target: { value: 'Custom section' } });
    fireEvent.click(screen.getByTestId('message-question-back'));
    expect(screen.getByTestId('message-question-option-0-Simple').querySelector('input')).toBeChecked();
    fireEvent.click(screen.getByTestId('message-question-next'));
    expect(screen.getByTestId('message-question-option-1-Summary').querySelector('input')).toBeChecked();
    expect(screen.getByTestId('message-question-other-input-1')).toHaveValue('Custom section');
    fireEvent.click(screen.getByTestId('message-question-submit'));
    await waitFor(() => expect(answerAsk).toHaveBeenCalledTimes(1));
    expect(answerAsk).toHaveBeenCalledWith({
      conversation_id: 'conversation-a',
      request_id: 'ask-a',
      answers: [
        { question: 'Which style?', labels: ['Simple'] },
        { question: 'Which sections?', labels: ['Summary', 'Custom section'] },
      ],
    });
  });
  it('preserves selections after submission failure and retries without duplicate submission', async () => {
    answerAsk.mockRejectedValueOnce(new Error('private upstream body'));
    const resolved = vi.fn();
    render(<MessageQuestion message={message()} onResolved={resolved} />);
    complete();
    fireEvent.click(screen.getByTestId('message-question-submit'));
    expect(await screen.findByTestId('message-question-error')).toBeInTheDocument();
    expect(screen.queryByText('private upstream body')).not.toBeInTheDocument();
    expect(screen.getByTestId('message-question-option-1-Summary').querySelector('input')).toBeChecked();
    fireEvent.click(screen.getByTestId('message-question-submit'));
    await waitFor(() => expect(resolved).toHaveBeenCalledWith('ask-a'));
    expect(answerAsk).toHaveBeenCalledTimes(2);
  });
  it('guards rapid submit and decline synchronously until response arrives', async () => {
    let finish!: () => void;
    answerAsk.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    render(<MessageQuestion message={message()} />);
    complete();
    const submit = screen.getByTestId('message-question-submit');
    const decline = screen.getByTestId('message-question-decline');
    act(() => {
      fireEvent.click(submit);
      fireEvent.click(submit);
      fireEvent.click(decline);
    });
    expect(answerAsk).toHaveBeenCalledTimes(1);
    expect(decline).toBeDisabled();
    await act(async () => finish());
    expect(screen.getByText('messages.askAnswered')).toBeInTheDocument();
  });
  it('declines a partial request explicitly and allows decline retry after failure', async () => {
    answerAsk.mockRejectedValueOnce(new Error('network'));
    render(<MessageQuestion message={message()} />);
    fireEvent.click(screen.getByTestId('message-question-decline'));
    await screen.findByTestId('message-question-error');
    fireEvent.click(screen.getByTestId('message-question-decline'));
    await screen.findByText('messages.askDeclined');
    expect(answerAsk).toHaveBeenLastCalledWith({
      conversation_id: 'conversation-a',
      request_id: 'ask-a',
      decline: true,
    });
  });
  it('resets drafts on scope change and ignores the previous request completion', async () => {
    let finish!: () => void;
    answerAsk.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const resolved = vi.fn();
    const view = render(<MessageQuestion message={message()} onResolved={resolved} />);
    complete();
    fireEvent.click(screen.getByTestId('message-question-submit'));
    view.rerender(<MessageQuestion message={message('conversation-b', 'ask-b')} onResolved={resolved} />);
    expect(screen.getByTestId('message-question-next')).toBeDisabled();
    await act(async () => finish());
    expect(resolved).not.toHaveBeenCalled();
    expect(screen.queryByText('messages.askAnswered')).not.toBeInTheDocument();
  });
  it('requires selected Other text and rejects excessive UTF-8 bytes before the API', () => {
    render(<MessageQuestion message={message()} />);
    complete();
    fireEvent.click(screen.getByTestId('message-question-option-1-other'));
    expect(screen.getByTestId('message-question-submit')).toBeDisabled();
    fireEvent.change(screen.getByTestId('message-question-other-input-1'), { target: { value: '한'.repeat(1000) } });
    expect(screen.getByTestId('message-question-submit')).toBeDisabled();
    expect(answerAsk).not.toHaveBeenCalled();
  });
  it('does not skip an unanswered question on rapid next clicks', () => {
    const ask = message();
    ask.content.questions.push({ question: 'Last question?', options: [{ label: 'Yes' }] });
    render(<MessageQuestion message={ask} />);
    fireEvent.click(screen.getByTestId('message-question-option-0-Simple'));
    const next = screen.getByTestId('message-question-next');
    act(() => {
      fireEvent.click(next);
      fireEvent.click(next);
    });
    expect(screen.getByText('Which sections?')).toBeInTheDocument();
    expect(screen.queryByText('Last question?')).not.toBeInTheDocument();
  });
});

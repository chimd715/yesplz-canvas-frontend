/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * AionrsChat must inject the conversation detail's `fork_capability` into
 * ConversationContext — that context value is the only thing gating the
 * shared message fork button (see MessageText + isForkEnabled). A dropped
 * prop silently hides the fork entry point for every aionrs conversation,
 * which is exactly the bug this guards against.
 */

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, Link, RouterProvider, useParams } from 'react-router-dom';
import type { MessageCursorPage } from '@/common/adapter/ipcBridge';
import type { TMessage } from '@/common/chat/chatLib';

const historyMocks = vi.hoisted(() => ({ get: vi.fn(), account: { id: 'test-user' }, unsubscribe: vi.fn() }));
vi.mock('@/common', () => ({
  ipcBridge: {
    database: { getConversationMessages: { invoke: historyMocks.get } },
    conversation: {
      userCreated: { on: vi.fn(() => historyMocks.unsubscribe) },
      statusChanged: { on: vi.fn(() => historyMocks.unsubscribe) },
      turnCompleted: { on: vi.fn(() => historyMocks.unsubscribe) },
    },
  },
}));

vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: historyMocks.account.id }, status: 'authenticated' }),
}));

// Probe replaces the heavy MessageList: it renders whatever forkCapability
// value reaches ConversationContext, so assertions read the real context.
vi.mock('@renderer/pages/conversation/Messages/MessageList', async () => {
  const { useConversationContextSafe } = await import('@/renderer/hooks/context/ConversationContext');
  const ReactModule = await import('react');
  const { useMessageList, useMessageListLoading } = await import('@renderer/pages/conversation/Messages/hooks');
  const Probe: React.FC<Record<string, unknown>> = () => {
    const ctx = useConversationContextSafe();
    const messages = useMessageList();
    const loading = useMessageListLoading();
    return ReactModule.createElement(
      'div',
      null,
      ReactModule.createElement(
        'div',
        { 'data-testid': 'fork-capability-probe' },
        JSON.stringify(ctx?.forkCapability ?? null)
      ),
      ReactModule.createElement(
        'div',
        { 'data-testid': 'persisted-history', 'data-loading': String(loading) },
        messages.map((message) => (message.type === 'text' ? message.content.content : '')).join('\n')
      )
    );
  };
  return { __esModule: true, default: Probe };
});

vi.mock('@renderer/pages/conversation/platforms/aionrs/AionrsSendBox', () => ({
  __esModule: true,
  default: () => null,
}));

// This test is about ConversationContext wiring only; the plan bar pulls in the
// message list + runtime view, neither of which this file's narrow mocks provide.
vi.mock('@renderer/pages/conversation/PlanBar/ConversationPlanBar', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('@renderer/pages/conversation/PlanBar/usePlanRecovery', () => ({
  __esModule: true,
  usePlanRecovery: () => {},
}));

vi.mock('@renderer/pages/conversation/Messages/UserQuestions', () => ({ default: () => null }));
vi.mock('@renderer/pages/conversation/platforms/aionrs/SecureSecrets', () => ({ default: () => null }));

vi.mock('@renderer/pages/conversation/Messages/historyScope/usePendingConfirmationsRecovery', () => ({
  __esModule: true,
  usePendingConfirmationsRecovery: () => {},
}));

vi.mock('@renderer/pages/conversation/Messages/artifacts', () => ({
  __esModule: true,
  ConversationArtifactProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

import AionrsChat from '@renderer/pages/conversation/platforms/aionrs/AionrsChat';
import type { AionrsModelSelection } from '@renderer/pages/conversation/platforms/aionrs/useAionrsModelSelection';

const renderChat = (forkCapability?: { at_turn: boolean }) =>
  render(
    <AionrsChat
      conversation_id='conv-aionrs-1'
      workspace='/workspace/demo'
      modelSelection={{} as AionrsModelSelection}
      forkCapability={forkCapability}
    />
  );

const historyPage = (content?: string): MessageCursorPage<TMessage> => ({
  items: content
    ? [
        {
          id: 'persisted',
          msg_id: 'persisted',
          type: 'text',
          conversation_id: 'conv-aionrs-1',
          position: 'left',
          content: { content },
        },
      ]
    : [],
  oldest_cursor: 'oldest',
  newest_cursor: 'newest',
  has_more_before: false,
  has_more_after: false,
});

beforeEach(() => {
  historyMocks.account.id = 'test-user';
  historyMocks.unsubscribe.mockClear();
  historyMocks.get.mockReset().mockResolvedValue(historyPage());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AionrsChat fork capability wiring', () => {
  it('exposes the fork capability from the conversation detail to the message context', async () => {
    renderChat({ at_turn: false });
    await act(async () => {});
    expect(screen.getByTestId('fork-capability-probe').textContent).toBe('{"at_turn":false}');
  });

  it('leaves the context without a capability when the detail declares none, keeping fork hidden', async () => {
    renderChat(undefined);
    await act(async () => {});
    expect(screen.getByTestId('fork-capability-probe').textContent).toBe('null');
  });
});

describe('native conversation navigation history', () => {
  const ConversationRoute = () => {
    const { id } = useParams();
    return (
      <>
        <Link to='/'>Home</Link>
        <AionrsChat conversation_id={id!} workspace='/workspace/demo' modelSelection={{} as AionrsModelSelection} />
      </>
    );
  };
  const HomeRoute = () => <Link to='/conversation/conv-aionrs-1'>Sidebar conversation</Link>;

  it.each([false, true])(
    'restores persisted history after Back then sidebar reopen and ignores the old request (rejected: %s)',
    async (rejected) => {
      let finish!: (page: MessageCursorPage<TMessage>) => void;
      let fail!: (error: Error) => void;
      historyMocks.get.mockReturnValueOnce(
        new Promise<MessageCursorPage<TMessage>>((resolve, reject) => {
          finish = resolve;
          fail = reject;
        })
      );
      const router = createMemoryRouter(
        [
          { path: '/', element: <HomeRoute /> },
          { path: '/conversation/:id', element: <ConversationRoute /> },
        ],
        { initialEntries: ['/'] }
      );
      render(<RouterProvider router={router} />);
      fireEvent.click(screen.getByRole('link', { name: 'Sidebar conversation' }));
      await waitFor(() => expect(historyMocks.get).toHaveBeenCalledTimes(1));
      await act(() => router.navigate(-1));
      expect(router.state.historyAction).toBe('POP');
      expect(screen.queryByTestId('persisted-history')).toBeNull();
      expect(historyMocks.unsubscribe).toHaveBeenCalledTimes(3);
      historyMocks.get.mockResolvedValueOnce(historyPage('Persisted messages after reopening'));
      fireEvent.click(screen.getByRole('link', { name: 'Sidebar conversation' }));
      await waitFor(() =>
        expect(screen.getByTestId('persisted-history').textContent).toBe('Persisted messages after reopening')
      );
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      await act(async () => {
        if (rejected) fail(new Error('old request failed'));
        else finish(historyPage());
      });
      expect(screen.getByTestId('persisted-history').textContent).toBe('Persisted messages after reopening');
      expect(screen.getByTestId('persisted-history').getAttribute('data-loading')).toBe('false');
      expect(historyMocks.get).toHaveBeenCalledTimes(2);
      expect(error).not.toHaveBeenCalled();
    }
  );

  it('starts a separate native provider when the account changes with the same conversation id', async () => {
    historyMocks.get.mockResolvedValueOnce(historyPage('Private first account history'));
    const view = renderChat();
    await waitFor(() =>
      expect(screen.getByTestId('persisted-history').textContent).toBe('Private first account history')
    );
    historyMocks.account.id = 'second-account';
    historyMocks.get.mockReturnValueOnce(new Promise(() => {}));
    view.rerender(
      <AionrsChat
        conversation_id='conv-aionrs-1'
        workspace='/workspace/demo'
        modelSelection={{} as AionrsModelSelection}
      />
    );
    expect(screen.getByTestId('persisted-history').textContent).toBe('');
    expect(screen.getByTestId('persisted-history').getAttribute('data-loading')).toBe('true');
    expect(historyMocks.unsubscribe).toHaveBeenCalledTimes(3);
    expect(historyMocks.get).toHaveBeenCalledTimes(2);
  });
});

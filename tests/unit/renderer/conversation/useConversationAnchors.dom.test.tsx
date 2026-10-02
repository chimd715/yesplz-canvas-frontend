/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TMessage } from '@/common/chat/chatLib';
import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadAllConversationMessagesPaged = vi.fn();
const fixture = vi.hoisted(() => ({
  messages: [] as TMessage[],
  conversation: { conversation_id: 'c1', type: 'aionrs' },
  team: null as { isTeamMode: true } | null,
  scope: { current: { conversationId: 'c1', active: true, epoch: 0, window: 'latest' } },
}));

vi.mock('@/renderer/hooks/context/ConversationContext', () => ({
  useConversationContextSafe: () => fixture.conversation,
}));
vi.mock('@/renderer/pages/team/hooks/TeamPermissionContext', () => ({
  useTeamPermission: () => fixture.team,
}));
vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({ useMessageList: () => fixture.messages }));
vi.mock('@/renderer/pages/conversation/Messages/historyScope/useHistoryRequestScope', () => ({
  useHistoryRequestScope: () => fixture.scope,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

vi.mock('@/renderer/utils/chat/messagePagination', () => ({
  loadAllConversationMessagesPaged: (...args: unknown[]) => loadAllConversationMessagesPaged(...args),
}));

const { useConversationAnchors } =
  await import('@/renderer/pages/conversation/Messages/anchorRail/useConversationAnchors');
const { MessageAnchorRail } = await import('@/renderer/pages/conversation/Messages/anchorRail');
const { CHAT_MESSAGE_JUMP_EVENT } = await import('@/renderer/utils/chat/chatMinimapEvents');

/** Builds one user/assistant turn pair. */
const turn = (n: number): TMessage[] =>
  [
    {
      id: `u-${n}`,
      msg_id: `u-${n}`,
      conversation_id: 'c1',
      type: 'text',
      position: 'right',
      created_at: n * 2,
      content: { content: `question ${n}` },
    },
    {
      id: `a-${n}`,
      msg_id: `a-${n}`,
      conversation_id: 'c1',
      type: 'text',
      position: 'left',
      created_at: n * 2 + 1,
      content: { content: `answer ${n}` },
    },
  ] as unknown as TMessage[];

const history = (count: number) => Array.from({ length: count }, (_, i) => turn(i + 1)).flat();

describe('useConversationAnchors', () => {
  beforeEach(() => {
    cleanup();
    loadAllConversationMessagesPaged.mockReset();
    fixture.messages = [];
    fixture.conversation = { conversation_id: 'c1', type: 'aionrs' };
    fixture.team = null;
    fixture.scope.current = { conversationId: 'c1', active: true, epoch: 0, window: 'latest' };
    delete window.electronAPI;
  });

  it('uses only the currently loaded customer window and replaces anchors on endpoint navigation', () => {
    const { result, rerender } = renderHook(({ live }) => useConversationAnchors('c1', live, true), {
      initialProps: { live: history(40).slice(-4) },
    });
    expect(result.current.map((anchor) => anchor.question)).toEqual(['question 39', 'question 40']);
    fixture.scope.current.window = 'first';
    rerender({ live: history(2) });
    expect(result.current.map((anchor) => anchor.question)).toEqual(['question 1', 'question 2']);
    rerender({ live: history(3) });
    expect(result.current).toHaveLength(3);
    fixture.scope.current.window = 'latest';
    rerender({ live: history(40).slice(-4) });
    expect(result.current.map((anchor) => anchor.question)).toEqual(['question 39', 'question 40']);
    expect(loadAllConversationMessagesPaged).not.toHaveBeenCalled();
  });

  it('rejects foreign cached rows and inactive or mismatched customer history scopes', () => {
    const { result, rerender } = renderHook(({ id }) => useConversationAnchors(id, history(2), true), {
      initialProps: { id: 'c1' },
    });
    expect(result.current).toHaveLength(2);
    rerender({ id: 'c2' });
    expect(result.current).toEqual([]);
    fixture.scope.current.conversationId = 'c2';
    rerender({ id: 'c2' });
    expect(result.current).toEqual([]);
    fixture.scope.current.conversationId = 'c1';
    fixture.scope.current.active = false;
    rerender({ id: 'c1' });
    expect(result.current).toEqual([]);
    expect(loadAllConversationMessagesPaged).not.toHaveBeenCalled();
  });

  it('cancels an older whole-history result when entering bounded customer mode', async () => {
    let resolveHistory!: (rows: TMessage[]) => void;
    loadAllConversationMessagesPaged.mockReturnValue(new Promise<TMessage[]>((resolve) => (resolveHistory = resolve)));
    const { result, rerender } = renderHook(({ bounded }) => useConversationAnchors('c1', history(2), bounded), {
      initialProps: { bounded: false },
    });
    expect(loadAllConversationMessagesPaged).toHaveBeenCalledOnce();
    rerender({ bounded: true });
    await act(async () => resolveHistory(history(40)));
    expect(result.current).toHaveLength(2);
    expect(loadAllConversationMessagesPaged).toHaveBeenCalledOnce();
  });

  it('renders bounded native browser ticks and dispatches a scoped keyboard jump without fetching history', () => {
    fixture.messages = history(40).slice(-4);
    const jump = vi.fn();
    window.addEventListener(CHAT_MESSAGE_JUMP_EVENT, jump);
    try {
      render(<MessageAnchorRail />);
      const ticks = screen.getAllByTestId('message-anchor-tick');
      expect(ticks).toHaveLength(2);
      fireEvent.keyDown(ticks[0], { key: 'Enter' });
      expect(jump).toHaveBeenCalledOnce();
      expect((jump.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
        conversation_id: 'c1',
        messageId: 'u-39',
        msgId: 'u-39',
        align: 'start',
      });
      expect(loadAllConversationMessagesPaged).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(CHAT_MESSAGE_JUMP_EVENT, jump);
    }
  });

  it.each(['desktop', 'team', 'legacy'])('preserves whole-history anchors for %s', async (surface) => {
    fixture.messages = history(2);
    if (surface === 'desktop') window.electronAPI = {} as NonNullable<typeof window.electronAPI>;
    if (surface === 'team') fixture.team = { isTeamMode: true };
    if (surface === 'legacy') fixture.conversation.type = 'acp';
    loadAllConversationMessagesPaged.mockResolvedValue(history(40));
    render(<MessageAnchorRail />);
    await waitFor(() => expect(screen.getAllByTestId('message-anchor-tick')).toHaveLength(40));
    expect(loadAllConversationMessagesPaged).toHaveBeenCalledWith('c1', { contentMode: 'compact' });
  });

  it('covers the whole history even when the chat area has only paged in the tail', async () => {
    // The regression this exists for: reopening an old conversation used to show a
    // rail with only the newest page's turns, so earlier ones had no tick at all.
    loadAllConversationMessagesPaged.mockResolvedValue(history(40));
    const paged = history(40).slice(-4); // chat area holds the last 2 turns

    const { result } = renderHook(() => useConversationAnchors('c1', paged));

    await waitFor(() => expect(result.current).toHaveLength(40));
    expect(result.current[0]?.question).toContain('question 1');
    expect(result.current[39]?.question).toContain('question 40');
  });

  it('reads previews rather than whole message bodies', async () => {
    loadAllConversationMessagesPaged.mockResolvedValue(history(3));
    renderHook(() => useConversationAnchors('c1', []));

    await waitFor(() => expect(loadAllConversationMessagesPaged).toHaveBeenCalled());
    expect(loadAllConversationMessagesPaged).toHaveBeenCalledWith('c1', { contentMode: 'compact' });
  });

  it('lets newly sent messages extend the rail without re-reading history', async () => {
    loadAllConversationMessagesPaged.mockResolvedValue(history(5));
    const { result, rerender } = renderHook(({ live }) => useConversationAnchors('c1', live), {
      initialProps: { live: history(5) },
    });

    await waitFor(() => expect(result.current).toHaveLength(5));

    // A new turn arrives in memory; the rail must grow immediately.
    rerender({ live: history(6) });
    await waitFor(() => expect(result.current).toHaveLength(6));
    expect(loadAllConversationMessagesPaged).toHaveBeenCalledTimes(1);
  });

  it('drops the previous conversation ticks when switching', async () => {
    loadAllConversationMessagesPaged.mockImplementation((id: string) =>
      Promise.resolve(id === 'c1' ? history(30) : history(2))
    );

    const { result, rerender } = renderHook(({ id }) => useConversationAnchors(id, []), {
      initialProps: { id: 'c1' },
    });
    await waitFor(() => expect(result.current).toHaveLength(30));

    rerender({ id: 'c2' });
    // Must not keep showing c1's 30 ticks while c2 is open.
    await waitFor(() => expect(result.current).toHaveLength(2));
  });

  it('ignores a slow response that lands after the conversation changed', async () => {
    let resolveFirst: ((messages: TMessage[]) => void) | undefined;
    loadAllConversationMessagesPaged.mockImplementation((id: string) => {
      if (id === 'c1') return new Promise<TMessage[]>((resolve) => (resolveFirst = resolve));
      return Promise.resolve(history(3));
    });

    const { result, rerender } = renderHook(({ id }) => useConversationAnchors(id, []), {
      initialProps: { id: 'c1' },
    });
    rerender({ id: 'c2' });
    await waitFor(() => expect(result.current).toHaveLength(3));

    // c1's request finally resolves — it must not overwrite c2's ticks.
    await act(async () => {
      resolveFirst?.(history(30));
    });
    expect(result.current).toHaveLength(3);
  });

  it('falls back to the in-memory list when the history read fails', async () => {
    loadAllConversationMessagesPaged.mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useConversationAnchors('c1', history(2)));

    // Degrades to whatever the chat area has, rather than rendering nothing.
    await waitFor(() => expect(result.current).toHaveLength(2));
  });

  it('renders no ticks without a conversation', () => {
    const { result } = renderHook(() => useConversationAnchors(undefined, []));
    expect(result.current).toEqual([]);
    expect(loadAllConversationMessagesPaged).not.toHaveBeenCalled();
  });
});

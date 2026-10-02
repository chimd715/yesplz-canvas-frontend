/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TMessage } from '@/common/chat/chatLib';
import { loadAllConversationMessagesPaged } from '@/renderer/utils/chat/messagePagination';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useHistoryRequestScope } from '../historyScope/useHistoryRequestScope';
import { buildMessageAnchors, type MessageAnchorItem } from './anchors';

/**
 * Customer chat anchors follow the current bounded history window without
 * background reads. Other surfaces retain their whole-history rail.
 *
 * The chat area loads messages lazily, so reopening an old conversation starts
 * with only the newest page. Deriving ticks from that alone made the rail claim a
 * long conversation was short: earlier turns simply had no anchor until the user
 * scrolled up far enough to page them in — which defeats the point of a jump
 * target. The desktop/legacy rail therefore reads the full turn list once,
 * the same way the search panel and conversation export do.
 *
 * The fetched list seeds the rail; the in-memory list then takes over whenever it
 * covers more turns, which is what keeps new messages appearing live without
 * re-reading history on every send.
 */
export const useConversationAnchors = (
  conversationId: string | undefined,
  liveMessages: TMessage[],
  bounded = false
): MessageAnchorItem[] => {
  const historyScope = useHistoryRequestScope(conversationId);
  const [historyAnchors, setHistoryAnchors] = useState<MessageAnchorItem[]>([]);
  // Guards against a stale conversation's response landing after a switch.
  const requestedIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    requestedIdRef.current = conversationId;
    if (!conversationId || bounded) {
      setHistoryAnchors([]);
      return;
    }

    let cancelled = false;
    // Drop the previous conversation's ticks immediately, so the rail never shows
    // one conversation's anchors while another is open.
    setHistoryAnchors([]);

    // `compact` is enough: ticks only need the preview text, not whole message
    // bodies, and a long history would otherwise pull a lot of unused content.
    loadAllConversationMessagesPaged(conversationId, { contentMode: 'compact' })
      .then((messages) => {
        if (cancelled || requestedIdRef.current !== conversationId) return;
        setHistoryAnchors(buildMessageAnchors(messages));
      })
      .catch(() => {
        // Best-effort: the rail still works off the in-memory list, it just starts
        // at whatever the chat area has paged in.
        if (cancelled || requestedIdRef.current !== conversationId) return;
        setHistoryAnchors([]);
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, bounded]);

  const liveAnchors = useMemo(
    () =>
      buildMessageAnchors(
        bounded ? liveMessages.filter((message) => message.conversation_id === conversationId) : liveMessages
      ),
    [liveMessages, conversationId, bounded]
  );

  const wholeHistoryAnchors = useMemo(
    () => (liveAnchors.length >= historyAnchors.length ? liveAnchors : historyAnchors),
    [liveAnchors, historyAnchors]
  );
  if (!bounded) return wholeHistoryAnchors;
  // The cache owns this scope. A previous route's cached rows must not become
  // clickable while the new conversation is hydrating or has been unmounted.
  return historyScope.current.active && historyScope.current.conversationId === conversationId ? liveAnchors : [];
};

/** @license Copyright 2025 AionUi (aionui.com) SPDX-License-Identifier: Apache-2.0 */
import { ipcBridge } from '@/common';
import { realtime } from '@/common/adapter/ipcBridge';
import type { IConfirmation, IMessageAsk } from '@/common/chat/chatLib';
import { useCallback, useEffect, useRef, useState } from 'react';
import { buildPendingConfirmationMessage } from '../usePendingConfirmationsRecovery';

type Pending = { confirmationId: string; message: IMessageAsk };
/** Questions have their own live state; pagination/history cannot remove or resurrect the dock. */
export function usePendingQuestions(conversationId: string) {
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState(false);
  const mounted = useRef(false);
  const epoch = useRef(0);
  const querying = useRef<symbol | null>(null);
  const refresh = useCallback(async (): Promise<void> => {
    if (querying.current || !mounted.current) return;
    const query = Symbol();
    querying.current = query;
    const started = epoch.current;
    try {
      const confirmations = await ipcBridge.conversation.confirmation.list.invoke({ conversation_id: conversationId });
      if (!mounted.current || epoch.current !== started || querying.current !== query) return;
      setPending((previous) =>
        (confirmations ?? []).flatMap((confirmation: IConfirmation<unknown>) => {
          if (!Array.isArray(confirmation.questions) || confirmation.questions.length === 0) return [];
          const message = buildPendingConfirmationMessage(conversationId, confirmation);
          if (message.type !== 'ask') return [];
          const existing = previous.find((row) => row.message.content.request_id === message.content.request_id);
          return [{ confirmationId: confirmation.id, message: existing?.message ?? message }];
        })
      );
      setError(false);
    } catch {
      if (mounted.current && epoch.current === started && querying.current === query) setError(true);
    } finally {
      if (querying.current === query) querying.current = null;
    }
  }, [conversationId]);

  const resolve = useCallback((requestId: string) => {
    epoch.current += 1;
    setPending((previous) => previous.filter((row) => row.message.content.request_id !== requestId));
  }, []);

  useEffect(() => {
    mounted.current = true;
    const offStream = ipcBridge.conversation.responseStream.on((event) => {
      if (event.conversation_id !== conversationId) return;
      if (event.type === 'ask') {
        const data = event.data as IMessageAsk['content'];
        if (!data?.request_id || !Array.isArray(data.questions) || !data.questions.length) return;
        epoch.current += 1;
        setError(false);
        setPending((previous) =>
          previous.some((row) => row.message.content.request_id === data.request_id)
            ? previous
            : [
                ...previous,
                {
                  confirmationId: data.request_id,
                  message: {
                    id: data.request_id,
                    type: 'ask',
                    conversation_id: conversationId,
                    position: 'left',
                    content: data,
                  },
                },
              ]
        );
      } else if (event.type === 'finish' || event.type === 'error') {
        epoch.current += 1;
        setPending([]);
      }
    });
    const offRemove = ipcBridge.conversation.confirmation.remove.on((event) => {
      if (event.conversation_id !== conversationId) return;
      epoch.current += 1;
      setPending((previous) =>
        previous.filter((row) => row.confirmationId !== event.id && row.message.content.request_id !== event.id)
      );
    });
    const offReconnect = realtime.reconnected.on(() => void refresh());
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    void refresh();
    // Polling also reconciles cancellations and requests completed in another client.
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      mounted.current = false;
      epoch.current += 1;
      // A StrictMode effect restart must start recovery even if the old request is still in flight.
      querying.current = null;
      offStream();
      offRemove();
      offReconnect();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [conversationId, refresh]);
  return { pending, error, refresh, resolve };
}

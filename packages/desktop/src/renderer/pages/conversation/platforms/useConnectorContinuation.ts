import { useEffect, useRef } from 'react';
import { Message } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { emitter, useAddEventListener } from '@/renderer/utils/emitter';
import { useLatestRef } from '@/renderer/hooks/ui/useLatestRef';

export const shopifyPendingKey = (conversationId: string) => `shopify_pending_${conversationId}`;

/** An explicit connector action uses the conversation's existing queue and history path. */
export async function submitConnectorPrompt(input: string, conversationId: string) {
  let accepted = false;
  emitter.emit('sendbox.connector.submit', input, conversationId, (value) => {
    accepted ||= value;
  });
  if (!accepted) throw new Error('Conversation unavailable');
}

export function useConnectorContinuation(conversationId: string, ready: boolean, accept: (input: string) => boolean) {
  const { t } = useTranslation();
  const acceptRef = useLatestRef(accept);
  const readyRef = useLatestRef(ready);
  const processing = useRef<AbortController | null>(null);
  useAddEventListener(
    'sendbox.connector.submit',
    (input, target, done) => {
      if (target !== conversationId) return;
      try {
        done(readyRef.current && acceptRef.current(input));
      } catch {
        done(false);
      }
    },
    [conversationId]
  );

  useEffect(() => {
    const [path, query] = window.location.hash.split('?');
    const params = new URLSearchParams(query);
    const entry = params.get('shopify_connected');
    if (
      !ready ||
      processing.current ||
      path !== `#/conversation/${conversationId}` ||
      !entry ||
      !/^[A-Za-z0-9_-]{43}$/.test(entry) ||
      sessionStorage.getItem(shopifyPendingKey(conversationId)) !== entry
    )
      return;
    const controller = new AbortController();
    processing.current = controller;
    void fetch('/api/platform/connectors/shopify?conversationId=' + encodeURIComponent(conversationId), {
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Connection unavailable');
        const status = await response.json();
        if (controller.signal.aborted) return;
        if (
          status.connected !== true ||
          typeof status.shop !== 'string' ||
          !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(status.shop)
        )
          throw new Error('Store unavailable');
        if (!acceptRef.current(t('settings.plugins.shopify.continuePrompt', { shop: status.shop })))
          throw new Error('Conversation unavailable');
        sessionStorage.removeItem(shopifyPendingKey(conversationId));
        params.delete('shopify_connected');
        window.history.replaceState(
          window.history.state,
          '',
          window.location.pathname + window.location.search + path + (params.size ? '?' + params : '')
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) Message.error(t('settings.plugins.shopify.error'));
      })
      .finally(() => {
        if (processing.current === controller) processing.current = null;
      });
    return () => {
      controller.abort();
      if (processing.current === controller) processing.current = null;
    };
  }, [conversationId, ready, t, acceptRef]);
}

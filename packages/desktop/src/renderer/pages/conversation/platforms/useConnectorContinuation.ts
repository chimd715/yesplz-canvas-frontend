import { useEffect, useRef } from 'react';
import { Message } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { emitter, useAddEventListener } from '@/renderer/utils/emitter';
import { useLatestRef } from '@/renderer/hooks/ui/useLatestRef';
import { conversation } from '@/common/adapter/ipcBridge';
import { isStorePlatformQuestion } from '../Messages/MessageQuestion';

export const shopifyPendingKey = (conversationId: string) => `shopify_pending_${conversationId}`;

/** Display a failed OAuth return without resuming the agent or clearing unrelated draft text. */
export function useConnectorReturnError(route: string) {
  const { t } = useTranslation();
  useEffect(() => {
    const [path, query] = window.location.hash.split('?');
    const params = new URLSearchParams(query);
    const entry = params.get('shopify_failed');
    const key = path.replace(/^#\/(?:conversation\/)?/, '');
    if (!entry || !/^[A-Za-z0-9_-]{43}$/.test(entry) || sessionStorage.getItem(shopifyPendingKey(key)) !== entry)
      return;
    const code = params.get('shopify_error');
    Message.error({
      content: t(
        code === 'another_app'
          ? 'settings.plugins.shopify.errors.anotherApp'
          : code === 'access_denied'
            ? 'settings.plugins.shopify.errors.cancelled'
            : 'settings.plugins.shopify.errors.authorizationFailed'
      ),
      duration: 10000,
    });
    sessionStorage.removeItem(shopifyPendingKey(key));
    params.delete('shopify_failed');
    params.delete('shopify_error');
    window.history.replaceState(
      window.history.state,
      '',
      window.location.pathname + window.location.search + path + (params.size ? '?' + params : '')
    );
  }, [route, t]);
}

/** An explicit connector action uses the conversation's existing queue and history path. */
export async function submitConnectorPrompt(input: string, conversationId: string, shop?: string) {
  if (shop && (await answerShopifyQuestion(conversationId, shop))) return;
  let accepted = false;
  emitter.emit('sendbox.connector.submit', input, conversationId, (value) => {
    accepted ||= value;
  });
  if (!accepted) throw new Error('Conversation unavailable');
}

async function answerShopifyQuestion(conversationId: string, shop: string, signal?: AbortSignal) {
  const pending = await conversation.confirmation.list.invoke({ conversation_id: conversationId });
  if (signal?.aborted) throw new Error('Connection cancelled');
  const question = pending.find((item) => item.questions?.length === 1 && isStorePlatformQuestion(item.questions[0]));
  if (!question) return false;
  await conversation.answerAsk.invoke({
    conversation_id: conversationId,
    request_id: question.call_id,
    answers: [{ question: question.questions![0].question, labels: [`Shopify (selected store: ${shop})`] }],
  });
  return true;
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
        if (
          !(await answerShopifyQuestion(conversationId, status.shop, controller.signal)) &&
          !acceptRef.current(t('settings.plugins.shopify.continuePrompt', { shop: status.shop }))
        )
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

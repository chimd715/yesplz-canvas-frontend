import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Message } from '@arco-design/web-react';
import { conversation } from '@/common/adapter/ipcBridge';
import type { TChatConversation } from '@/common/config/storage';
import { widgetModeFixture } from '../../../fixtures/creationMode';
import {
  shopifyPendingKey,
  submitConnectorPrompt,
  useConnectorContinuation,
  useConnectorReturnError,
} from '@/renderer/pages/conversation/platforms/useConnectorContinuation';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock('@arco-design/web-react', () => ({ Message: { error: vi.fn() } }));
vi.mock('@/common/adapter/ipcBridge', () => ({
  conversation: {
    confirmation: { list: { invoke: vi.fn() } },
    answerAsk: { invoke: vi.fn() },
    get: { invoke: vi.fn() },
  },
}));
const translate = (key: string, values?: { shop?: string }) => (values?.shop ? `Connected to ${values.shop}` : key);
const entry = 'n'.repeat(43);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(conversation.confirmation.list.invoke).mockResolvedValue([]);
  vi.mocked(conversation.answerAsk.invoke).mockResolvedValue(undefined);
  vi.mocked(conversation.get.invoke).mockResolvedValue({ id: 'current', extra: {} } as TChatConversation);
  sessionStorage.clear();
  window.history.replaceState({}, '', '/#/conversation/current?shopify_connected=' + entry);
  sessionStorage.setItem(shopifyPendingKey('current'), entry);
});

it('shows a bound error once on the original route without resuming a successful connection', () => {
  window.history.replaceState(
    {},
    '',
    '/#/conversation/current?shopify_failed=' + entry + '&shopify_error=another_app&keep=1'
  );
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const accept = vi.fn(() => true);
  const hook = renderHook(
    () => {
      useConnectorReturnError('/conversation/current');
      useConnectorContinuation('current', true, accept);
    },
    { wrapper: ({ children }) => <React.StrictMode>{children}</React.StrictMode> }
  );
  expect(Message.error).toHaveBeenCalledExactlyOnceWith({
    content: 'settings.plugins.shopify.errors.anotherApp',
    duration: 10000,
  });
  expect(window.location.hash).toBe('#/conversation/current?keep=1');
  expect(fetcher).not.toHaveBeenCalled();
  expect(accept).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(shopifyPendingKey('current'))).toBeNull();
  hook.unmount();
  renderHook(() => useConnectorReturnError('/conversation/current'));
  expect(Message.error).toHaveBeenCalledTimes(1);
});

it('ignores a foreign error return and handles a cancellation from settings', () => {
  window.history.replaceState({}, '', '/#/conversation/other?shopify_failed=' + entry + '&shopify_error=another_app');
  const hook = renderHook(() => useConnectorReturnError('/conversation/other'));
  expect(Message.error).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(shopifyPendingKey('current'))).toBe(entry);
  hook.unmount();
  window.history.replaceState({}, '', '/#/settings/plugins?shopify_failed=' + entry + '&shopify_error=access_denied');
  sessionStorage.setItem(shopifyPendingKey('settings/plugins'), entry);
  renderHook(() => useConnectorReturnError('/settings/plugins'));
  expect(Message.error).toHaveBeenCalledWith({ content: 'settings.plugins.shopify.errors.cancelled', duration: 10000 });
});
afterEach(() => vi.unstubAllGlobals());

it('queues the verified selected shop once after OAuth, waits for readiness and preserves refresh safety', async () => {
  const fetcher = vi.fn(async () => ({
    ok: true,
    json: async () => ({ connected: true, shop: 'selected.myshopify.com' }),
  }));
  vi.stubGlobal('fetch', fetcher);
  const accept = vi.fn(() => true);
  const hook = renderHook(({ ready }) => useConnectorContinuation('current', ready, accept), {
    initialProps: { ready: false },
    wrapper: ({ children }) => <React.StrictMode>{children}</React.StrictMode>,
  });
  expect(fetcher).not.toHaveBeenCalled();
  hook.rerender({ ready: true });
  await waitFor(() => expect(accept).toHaveBeenCalledWith('Connected to selected.myshopify.com'));
  expect(window.location.hash).toBe('#/conversation/current');
  expect(sessionStorage.getItem(shopifyPendingKey('current'))).toBeNull();
  hook.unmount();
  window.history.replaceState({}, '', '/#/conversation/current?shopify_connected=' + entry);
  renderHook(() => useConnectorContinuation('current', true, accept));
  expect(accept).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('does not resume another conversation or unverified selection; explicit submissions target one queue', async () => {
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ connected: false }) }));
  vi.stubGlobal('fetch', fetcher);
  const other = vi.fn(() => true),
    current = vi.fn(() => true);
  renderHook(() => useConnectorContinuation('other', true, other));
  expect(fetcher).not.toHaveBeenCalled();
  const hook = renderHook(() => useConnectorContinuation('current', true, current));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  await act(async () => {});
  expect(current).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(shopifyPendingKey('current'))).toBe(entry);
  await act(() => submitConnectorPrompt('Use this selected shop', 'current'));
  expect(current).toHaveBeenCalledWith('Use this selected shop');
  expect(other).not.toHaveBeenCalled();
  hook.unmount();
  await expect(submitConnectorPrompt('Do not send elsewhere', 'current')).rejects.toThrow();
});

it('keeps the return available when queue admission fails and ignores an unrequested return', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ connected: true, shop: 'selected.myshopify.com' }) }))
  );
  const accept = vi.fn(() => false);
  const hook = renderHook(() => useConnectorContinuation('current', true, accept));
  await waitFor(() => expect(accept).toHaveBeenCalledTimes(1));
  expect(sessionStorage.getItem(shopifyPendingKey('current'))).toBe(entry);
  expect(window.location.hash).toContain('shopify_connected=');
  hook.unmount();
  sessionStorage.setItem(shopifyPendingKey('current'), 'different');
  renderHook(() => useConnectorContinuation('current', true, accept));
  expect(accept).toHaveBeenCalledTimes(1);
});

it.each([undefined, { ...widgetModeFixture, revision: 3 }])(
  'answers a historical pending question after OAuth, including older pinned catalog snapshots (%j)',
  async (creationMode) => {
    vi.mocked(conversation.get.invoke).mockResolvedValue({
      id: 'current',
      extra: { creationMode },
    } as TChatConversation);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ connected: true, shop: 'selected.myshopify.com' }) }))
    );
    vi.mocked(conversation.confirmation.list.invoke).mockResolvedValue([
      {
        id: 'pending',
        call_id: 'widget-data',
        questions: [
          { question: 'Which platform is your store on?', options: [{ label: 'Shopify' }, { label: 'Other' }] },
        ],
      },
    ] as Awaited<ReturnType<typeof conversation.confirmation.list.invoke>>);
    const accept = vi.fn(() => true);
    renderHook(() => useConnectorContinuation('current', true, accept));
    await waitFor(() =>
      expect(conversation.answerAsk.invoke).toHaveBeenCalledExactlyOnceWith({
        conversation_id: 'current',
        request_id: 'widget-data',
        answers: [
          {
            question: 'Which platform is your store on?',
            labels: ['Shopify (selected store: selected.myshopify.com)'],
          },
        ],
      })
    );
    expect(accept).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(shopifyPendingKey('current'))).toBeNull();
  }
);

it('keeps a failed question answer available for retry and never sends a second task', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ connected: true, shop: 'selected.myshopify.com' }) }))
  );
  vi.mocked(conversation.confirmation.list.invoke).mockResolvedValue([
    {
      id: 'pending',
      call_id: 'widget-data',
      questions: [
        { question: 'Which platform is your store on?', options: [{ label: 'Shopify' }, { label: 'Other' }] },
      ],
    },
  ] as Awaited<ReturnType<typeof conversation.confirmation.list.invoke>>);
  vi.mocked(conversation.answerAsk.invoke).mockRejectedValue(new Error('Unavailable'));
  const accept = vi.fn(() => true);
  renderHook(() => useConnectorContinuation('current', true, accept));
  await waitFor(() => expect(Message.error).toHaveBeenCalled());
  expect(accept).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(shopifyPendingKey('current'))).toBe(entry);
});

it('answers an explicit connector option regardless of its mode, question or label', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ connected: true, shop: 'selected.myshopify.com' }) }))
  );
  vi.mocked(conversation.confirmation.list.invoke).mockResolvedValue([
    {
      id: 'pending',
      call_id: 'source',
      questions: [
        {
          question: 'Pick your catalog',
          options: [{ label: 'My catalog', action: { type: 'connect', connector: 'shopify' } }],
        },
      ],
    },
  ] as Awaited<ReturnType<typeof conversation.confirmation.list.invoke>>);
  const accept = vi.fn(() => true);
  renderHook(() => useConnectorContinuation('current', true, accept));
  await waitFor(() =>
    expect(conversation.answerAsk.invoke).toHaveBeenCalledWith({
      conversation_id: 'current',
      request_id: 'source',
      answers: [{ question: 'Pick your catalog', labels: ['My catalog (selected store: selected.myshopify.com)'] }],
    })
  );
  expect(accept).not.toHaveBeenCalled();
  expect(conversation.get.invoke).not.toHaveBeenCalled();
});

it('does not apply historical text inference to a catalog mode or fabricate another question answer', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ connected: true, shop: 'selected.myshopify.com' }) }))
  );
  vi.mocked(conversation.get.invoke).mockResolvedValue({
    id: 'current',
    extra: { creationMode: { ...widgetModeFixture, interactionContract: 'explicit-actions-v1', revision: 2 } },
  } as TChatConversation);
  vi.mocked(conversation.confirmation.list.invoke).mockResolvedValue([
    {
      id: 'pending',
      call_id: 'source',
      questions: [
        { question: 'Which platform is your store on?', options: [{ label: 'Shopify' }, { label: 'Other' }] },
      ],
    },
  ] as Awaited<ReturnType<typeof conversation.confirmation.list.invoke>>);
  const accept = vi.fn(() => true);
  const hook = renderHook(() => useConnectorContinuation('current', true, accept));
  await waitFor(() => expect(sessionStorage.getItem(shopifyPendingKey('current'))).toBeNull());
  expect(conversation.answerAsk.invoke).not.toHaveBeenCalled();
  expect(accept).not.toHaveBeenCalled();
  hook.unmount();
  sessionStorage.setItem(shopifyPendingKey('current'), entry);
  window.history.replaceState({}, '', '/#/conversation/current?shopify_connected=' + entry);
  vi.mocked(conversation.confirmation.list.invoke).mockResolvedValue([
    {
      id: 'pending',
      call_id: 'source',
      questions: [
        {
          question: 'Pick your catalog',
          options: [{ label: 'My catalog', action: { type: 'connect', connector: 'shopify' } }],
        },
        { question: 'Which color?', options: [] },
      ],
    },
  ] as Awaited<ReturnType<typeof conversation.confirmation.list.invoke>>);
  renderHook(() => useConnectorContinuation('current', true, accept));
  await waitFor(() => expect(sessionStorage.getItem(shopifyPendingKey('current'))).toBeNull());
  expect(conversation.answerAsk.invoke).not.toHaveBeenCalled();
  expect(accept).not.toHaveBeenCalled();
});

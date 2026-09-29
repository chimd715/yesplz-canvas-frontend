import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  shopifyPendingKey,
  submitConnectorPrompt,
  useConnectorContinuation,
} from '@/renderer/pages/conversation/platforms/useConnectorContinuation';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock('@arco-design/web-react', () => ({ Message: { error: vi.fn() } }));
const translate = (_key: string, values?: { shop?: string }) => `Connected to ${values?.shop}`;
const entry = 'n'.repeat(43);
beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState({}, '', '/#/conversation/current?shopify_connected=' + entry);
  sessionStorage.setItem(shopifyPendingKey('current'), entry);
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

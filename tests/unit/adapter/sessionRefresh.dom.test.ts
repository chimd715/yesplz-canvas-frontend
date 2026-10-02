/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshSession, SessionRefreshUnavailableError } from '@/common/adapter/sessionRefresh';

type WindowWithPort = { __backendPort?: number };

describe('refreshSession (WebUI session refresh)', () => {
  beforeEach(() => {
    // Browser mode: real DOM (jsdom) with no Electron preload port.
    delete (window as WindowWithPort).__backendPort;
    vi.restoreAllMocks();
    document.cookie = 'aionui-csrf-token=; Max-Age=0; Path=/';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as WindowWithPort).__backendPort;
  });

  it('POSTs /api/auth/refresh with cookie credentials and an empty legacy fallback and resolves true on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await expect(refreshSession()).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/auth/refresh');
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' });
    // The HttpOnly cookie is the credential; the empty body keeps old Core compatible.
    expect(JSON.parse(init.body)).toEqual({ token: '' });
  });

  it('attaches the actual Core double-submit cookie to refresh requests', async () => {
    const token = 'a'.repeat(64);
    document.cookie = `aionui-csrf-token=${token}; Path=/`;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    await expect(refreshSession()).resolves.toBe(true);
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      'Content-Type': 'application/json',
      'x-csrf-token': token,
    });
  });

  it('resolves false when the refresh token is also expired (non-ok response)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(refreshSession()).resolves.toBe(false);
  });

  it('preserves the login decision on network failure by returning a retryable error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(refreshSession()).rejects.toBeInstanceOf(SessionRefreshUnavailableError);
  });

  it.each([403, 429, 500, 503])('does not treat HTTP %s as credential revocation', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status }));
    await expect(refreshSession()).rejects.toMatchObject({ status: 503, code: 'SESSION_REFRESH_UNAVAILABLE' });
  });

  it('single-flights concurrent callers into one POST, then refreshes anew afterwards', async () => {
    let resolveFetch: (value: { ok: boolean }) => void = () => {};
    const pending = new Promise<{ ok: boolean }>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn().mockReturnValueOnce(pending).mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const first = refreshSession();
    const second = refreshSession();
    // Both callers share the same in-flight request.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch({ ok: true });
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);

    // In-flight promise cleared after settling — a later call refreshes again.
    await expect(refreshSession()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('is a no-op (no fetch) outside WebUI browser mode', async () => {
    (window as WindowWithPort).__backendPort = 13400;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(refreshSession()).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

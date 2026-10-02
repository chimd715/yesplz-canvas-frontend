/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Browser cookie refresh shared by HTTP, realtime and auth status checks. */

import { resolveCoreCsrfToken } from './httpBridge';

/** WebSocket close code the backend uses for auth policy violations (RFC 6455 §7.4.1). */
export const WS_CLOSE_POLICY_VIOLATION = 1008;

const REFRESH_ENDPOINT = '/api/auth/refresh';

/**
 * WebUI browser mode = a real DOM with no Electron preload port. Only here do
 * cookie-based sessions (and thus refresh) exist; the desktop renderer talks to
 * a local-mode backend that needs no tokens. Kept in sync with the identical
 * check in `httpBridge.ts` (duplicated rather than imported to avoid coupling the
 * refresh primitive to the HTTP bridge).
 */
function isWebUiBrowserMode(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    !(window as { __backendPort?: number }).__backendPort
  );
}

export class SessionRefreshUnavailableError extends Error {
  readonly status = 503;
  readonly code = 'SESSION_REFRESH_UNAVAILABLE';

  constructor() {
    super('Session renewal temporarily unavailable');
    this.name = 'SessionRefreshUnavailableError';
  }
}

let inFlight: Promise<boolean> | null = null;

/**
 * Concurrent callers share one POST. False means a rejected credential (401) or
 * desktop mode. Outages, rate limits and CSRF errors throw a retryable error;
 * callers must preserve the session instead of treating those as a logout.
 */
export function refreshSession(): Promise<boolean> {
  if (!isWebUiBrowserMode()) {
    // Desktop/local mode has no refreshable cookie session.
    return Promise.resolve(false);
  }
  if (inFlight) {
    return inFlight;
  }
  inFlight = performRefresh().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function performRefresh(): Promise<boolean> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const csrfToken = resolveCoreCsrfToken();
    if (csrfToken) {
      headers['x-csrf-token'] = csrfToken;
    }
    const response = await fetch(REFRESH_ENDPOINT, {
      method: 'POST',
      // Same-origin request: the browser attaches the HttpOnly refresh cookie
      // (scoped to Path=/api/auth/refresh). An empty legacy credential makes old
      // Core return 401 when that cookie is absent instead of a JSON 415. No
      // browser-readable credential is stored or sent; the cookie takes priority.
      credentials: 'include',
      headers,
      body: JSON.stringify({ token: '' }),
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok) return true;
    if (response.status === 401) return false;
    throw new SessionRefreshUnavailableError();
  } catch {
    throw new SessionRefreshUnavailableError();
  }
}

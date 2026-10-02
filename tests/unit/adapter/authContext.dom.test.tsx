import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Reflect.deleteProperty(window, 'electronAPI');
});
vi.mock('@/renderer/pages/conversation/Preview/context/previewScope', () => ({ PREVIEW_SCOPE_KEY_PREFIX: 'preview:' }));
import { AuthProvider, useAuth } from '@/renderer/hooks/context/AuthContext';

const USER = { id: 'customer', username: 'customer' };
const success = () => Response.json({ success: true, user: USER });
const wrapper = ({ children }: React.PropsWithChildren) => <AuthProvider>{children}</AuthProvider>;

describe('customer session recovery', () => {
  beforeEach(() => {
    delete window.__backendPort;
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('preserves authenticated chat when a current-user request is temporarily unavailable', async () => {
    const fetcher = vi.fn().mockResolvedValue(success());
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(useAuth, { wrapper });
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    fetcher.mockResolvedValue(Response.json({}, { status: 503 }));
    await act(() => result.current.refresh());
    expect(result.current.user).toEqual(USER);
    expect(result.current.status).toBe('authenticated');
  });

  it('preserves authenticated chat when refresh fails due to a network outage', async () => {
    const fetcher = vi.fn().mockResolvedValue(success());
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(useAuth, { wrapper });
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    fetcher.mockImplementation(async (url: string) => {
      if (url === '/api/auth/refresh') throw new Error('offline');
      return Response.json({}, { status: 401 });
    });
    await act(() => result.current.refresh());
    expect(result.current.status).toBe('authenticated');
    expect(result.current.user).toEqual(USER);
  });

  it('ends the session when both access and refresh credentials are rejected', async () => {
    const fetcher = vi.fn().mockResolvedValue(success());
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(useAuth, { wrapper });
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    fetcher.mockImplementation(async () => Response.json({}, { status: 401 }));
    await act(() => result.current.refresh());
    expect(result.current.status).toBe('unauthenticated');
    expect(result.current.user).toBeNull();
  });

  it('recovers an initial outage on the online event without concluding that credentials expired', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(useAuth, { wrapper });
    expect(result.current.status).toBe('checking');
    fetcher.mockImplementation(async () => success());
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(result.current.user).toEqual(USER));
  });
  it('does not restore a login after explicit logout even when the server was unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(async (url: string) =>
          url === '/logout' ? Promise.reject(new Error('offline')) : success()
        )
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(useAuth, { wrapper });
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    await act(() => result.current.logout());
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(result.current.status).toBe('unauthenticated');
    expect(result.current.user).toBeNull();
  });
});

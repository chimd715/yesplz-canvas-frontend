import { refreshSession } from '@/common/adapter/sessionRefresh';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  listSecrets,
  requestSecret,
  uploadSecret,
  revokeSecret,
} from '@/renderer/pages/conversation/platforms/aionrs/SecureSecrets/client';
vi.mock('@/common/adapter/sessionRefresh', () => ({ refreshSession: vi.fn().mockResolvedValue(false) }));
const row = { id: 'a'.repeat(43), name: 'GITHUB_TOKEN', service: 'github', state: 'pending' };
afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(refreshSession).mockReset().mockResolvedValue(false);
});
describe('secure browser credential channel', () => {
  it('posts the value only to the dedicated credential endpoint with same-origin credentials', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ...row, state: 'stored' }));
    vi.stubGlobal('fetch', fetcher);
    await uploadSecret('chat-a', row.id, 'test-private-token');
    expect(fetcher.mock.calls[0][0]).toBe(`/api/platform/secrets/chat-a/${row.id}/value`);
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      credentials: 'same-origin',
      method: 'POST',
      body: JSON.stringify({ value: 'test-private-token' }),
    });
  });
  it('metadata requests never contain a credential value and revocation sends an empty body', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(row))
      .mockResolvedValueOnce(Response.json({ removed: true }));
    vi.stubGlobal('fetch', fetcher);
    await requestSecret('chat-a', row.name);
    await revokeSecret('chat-a', row.id);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ name: 'GITHUB_TOKEN', service: 'opaque' });
    expect(fetcher.mock.calls[1][1].body).toBeUndefined();
  });
  it('validates metadata and rejects invalid conversation/reference before network calls', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ secrets: [{ ...row, id: 'unsafe' }] }));
    vi.stubGlobal('fetch', fetcher);
    await expect(listSecrets('chat-a')).rejects.toThrow('secret_request_failed');
    await expect(uploadSecret('../other', row.id, 'token')).rejects.toThrow('secret_request_failed');
    await expect(uploadSecret('chat-a', '../other', 'token')).rejects.toThrow('secret_request_failed');
  });
  it('renews an expired session and replays the secure upload once without logging its value', async () => {
    vi.mocked(refreshSession).mockResolvedValue(true);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ ...row, state: 'stored' }));
    vi.stubGlobal('fetch', fetcher);
    const log = vi.spyOn(console, 'debug').mockImplementation(() => {});
    await uploadSecret('chat-a', row.id, 'private-token');
    expect(refreshSession).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
  it('does not expose credential-bearing server errors to UI', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private-token', { status: 500 })));
    await expect(uploadSecret('chat-a', row.id, 'private-token')).rejects.toThrow('secret_request_failed');
  });
  it('does not replay an upload if its scope is aborted while session refresh is in flight', async () => {
    let finishRefresh!: (result: boolean) => void;
    vi.mocked(refreshSession).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRefresh = resolve;
        })
    );
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    const upload = uploadSecret('chat-a', row.id, 'private-token', controller.signal);
    const rejected = expect(upload).rejects.toThrow();
    await vi.waitFor(() => expect(refreshSession).toHaveBeenCalledOnce());
    controller.abort();
    finishRefresh(true);
    await rejected;
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1].signal).toBe(controller.signal);
  });
});

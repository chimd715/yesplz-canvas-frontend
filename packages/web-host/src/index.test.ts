import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebHostOptions } from './types.js';

const mocks = vi.hoisted(() => ({ startBackend: vi.fn(), startStaticServer: vi.fn() }));
vi.mock('./backend-launcher.js', () => ({ startBackend: mocks.startBackend }));
vi.mock('./static-server.js', () => ({ startStaticServer: mocks.startStaticServer }));
import { startWebHost } from './index.js';

const opts: WebHostOptions = {
  app: { version: 'test', isPackaged: false, resourcesPath: '/resources', userDataPath: '/data' },
  dataDir: '/data',
  staticDir: '/static',
  backend: { kind: 'ownBackend', resolveBackend: () => '/binary' },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.startBackend.mockResolvedValue({ port: 1234, stop: vi.fn() });
  mocks.startStaticServer.mockResolvedValue({
    port: 5678,
    url: 'http://localhost:5678',
    localUrl: 'http://localhost:5678',
    stop: vi.fn(),
  });
});

describe('trusted hosted identity configuration', () => {
  it('leaves the backend identity unchanged when the caller omits the setting', async () => {
    await startWebHost(opts);
    expect(mocks.startBackend.mock.calls[0][0].identity).toBeUndefined();
  });
  it('passes the secret to backend startup only, never to the static server or returned browser URLs', async () => {
    const identity = { mode: 'aionpro' as const, bootstrapSecret: 'test-bootstrap-secret' };
    const handle = await startWebHost({
      ...opts,
      backend: { kind: 'ownBackend', resolveBackend: () => '/binary', identity },
    });
    expect(mocks.startBackend.mock.calls[0][0].identity).toEqual(identity);
    expect(JSON.stringify(mocks.startStaticServer.mock.calls)).not.toContain(identity.bootstrapSecret);
    expect(JSON.stringify(handle)).not.toContain(identity.bootstrapSecret);
  });
});

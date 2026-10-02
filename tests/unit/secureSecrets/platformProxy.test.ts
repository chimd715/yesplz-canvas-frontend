import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { startStaticServer } from '../../../packages/web-host/src/static-server';
const stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});
async function endpoint(marker: string) {
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({ marker, path: request.url, cookie: request.headers.cookie, origin: request.headers.origin })
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No endpoint');
  stops.push(() => new Promise((resolve) => server.close(() => resolve())));
  return address.port;
}
describe('trusted local platform API proxy', () => {
  it('routes only vault browser endpoints to the sidecar and preserves session/Origin headers', async () => {
    const core = await endpoint('core');
    const platform = await endpoint('platform');
    const host = await startStaticServer({ staticDir: '.', backendPort: core, platformApiPort: platform, port: 0 });
    stops.unshift(host.stop);
    const response = await fetch(`${host.localUrl}/api/platform/secrets/chat-a`, {
      headers: { Cookie: 'aionui-session=fixture', Origin: host.localUrl.replace(/\/$/, '') },
    });
    expect(await response.json()).toMatchObject({
      marker: 'platform',
      cookie: 'aionui-session=fixture',
      origin: host.localUrl.replace(/\/$/, ''),
    });
    expect(await (await fetch(`${host.localUrl}/api/conversations/chat-a`)).json()).toMatchObject({ marker: 'core' });
  });
  it('refuses a credential sidecar proxy on a remote host or invalid port', async () => {
    await expect(
      startStaticServer({ staticDir: '.', backendPort: 1, platformApiPort: 2, allowRemote: true })
    ).rejects.toThrow('local-only host');
    await expect(startStaticServer({ staticDir: '.', backendPort: 1, platformApiPort: 0 })).rejects.toThrow(
      'valid loopback port'
    );
  });
});

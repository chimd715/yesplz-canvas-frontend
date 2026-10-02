import { refreshSession } from '@/common/adapter/sessionRefresh';
export type SecretMetadata = { id: string; name: string; service: 'github' | 'opaque'; state: 'pending' | 'stored' };
const metadata = (value: unknown): value is SecretMetadata => {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    Object.keys(row).length === 4 &&
    typeof row.id === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(row.id) &&
    typeof row.name === 'string' &&
    /^[A-Z][A-Z0-9_]{0,63}$/.test(row.name) &&
    ['github', 'opaque'].includes(row.service as string) &&
    ['pending', 'stored'].includes(row.state as string)
  );
};
const endpoint = (conversationId: string) => {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(conversationId)) throw new Error('secret_request_failed');
  return `/api/platform/secrets/${encodeURIComponent(conversationId)}`;
};
async function call(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<unknown> {
  signal?.throwIfAborted();
  const options: RequestInit = { method, credentials: 'same-origin', signal, cache: 'no-store' };
  if (body !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }
  let response = await fetch(path, options);
  // Use the shared single-flight refresh, without the HTTP bridge's request-body logging.
  if (response.status === 401 && !signal?.aborted && (await refreshSession())) {
    signal?.throwIfAborted();
    response = await fetch(path, options);
  }
  if (!response.ok) throw new Error('secret_request_failed');
  return response.json();
}
export async function listSecrets(conversationId: string, signal?: AbortSignal): Promise<SecretMetadata[]> {
  const result = (await call(endpoint(conversationId), 'GET', undefined, signal)) as { secrets?: unknown };
  if (!Array.isArray(result.secrets) || !result.secrets.every(metadata)) throw new Error('secret_request_failed');
  return result.secrets;
}
export async function requestSecret(
  conversationId: string,
  name: string,
  service: 'github' | 'opaque' = 'opaque',
  signal?: AbortSignal
) {
  const result = await call(endpoint(conversationId), 'POST', { name, service }, signal);
  if (!metadata(result)) throw new Error('secret_request_failed');
  return result;
}
export async function uploadSecret(conversationId: string, id: string, value: string, signal?: AbortSignal) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(id)) throw new Error('secret_request_failed');
  const result = await call(`${endpoint(conversationId)}/${id}/value`, 'POST', { value }, signal);
  if (!metadata(result)) throw new Error('secret_request_failed');
  return result;
}
export async function revokeSecret(conversationId: string, id: string, signal?: AbortSignal) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(id)) throw new Error('secret_request_failed');
  await call(`${endpoint(conversationId)}/${id}`, 'DELETE', undefined, signal);
}

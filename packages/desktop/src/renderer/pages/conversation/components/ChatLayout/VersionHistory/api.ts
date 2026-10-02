import { z } from 'zod';
import { refreshSession } from '@/common/adapter/sessionRefresh';
import { isHistoricalPreviewUrl } from '@/renderer/utils/platform';

const id = z.string().min(1).max(200);
const versionSchema = z.object({
  id,
  label: z.string().max(1000),
  createdAt: z.number().int().nonnegative().max(8640000000000000),
  messageId: id,
  activeMessageId: id.optional(),
  sourceConversationId: id,
  parentRevisionId: id.nullable(),
  status: z.enum(['saved', 'building', 'ready', 'failed']),
  published: z.boolean().optional(),
  previewUrl: z.string().max(4096).optional(),
});
const revertedSchema = z.object({
  id,
  sourceConversationId: id,
  afterMessageId: id,
  afterActiveMessageId: id.optional(),
  revisionIds: z.array(id).optional(),
  label: z.string().max(1000).optional(),
});
export const versionHistorySchema = z.object({
  activeCoreConversationId: id,
  activeRevisionId: id.nullable(),
  headGeneration: z.number().int().nonnegative(),
  versions: z.array(versionSchema).max(10000),
  reverted: z.array(revertedSchema).max(10000),
});
export type SavedVersion = z.infer<typeof versionSchema>;
export type RevertedGroup = z.infer<typeof revertedSchema>;
export type VersionHistory = z.infer<typeof versionHistorySchema>;

const sourceVersionSchema = z.object({
  id: z.string().uuid(),
  appId: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }),
  sourceKind: z.enum(['static', 'node']),
  sourceRevision: z.string().regex(/^[a-f0-9]{64}$/),
  conversationId: id.optional(),
  logicalConversationId: id.optional(),
  previewUrl: z.string().max(4096).optional(),
});
const sourceHistorySchema = z.object({
  configured: z.boolean(),
  versions: z.array(sourceVersionSchema).max(10000),
  cards: z.array(z.object({ messageId: id, sourceVersionId: z.string().uuid() })).max(10000),
  latestSavedVersionId: z.string().uuid().optional(),
  publishedSourceVersionId: z.string().uuid().optional(),
});
export type SourceVersion = z.infer<typeof sourceVersionSchema>;
export type SourceHistory = z.infer<typeof sourceHistorySchema>;
export const isSourceVersion = (version: SavedVersion | SourceVersion): version is SourceVersion =>
  'sourceKind' in version;
export type VersionSelection =
  | { kind: 'current' }
  | { kind: 'source'; sourceVersionId: string }
  | { kind: 'native'; revisionId: string; logicalConversationId: string };

export const sourceVersionsPath = (conversationId: string): string =>
  `/api/platform/source-versions?conversationId=${encodeURIComponent(conversationId)}`;

/** Replay safe reads once after the same coalesced session refresh used by the Core bridge. */
async function fetchHistoryRead(path: string): Promise<Response> {
  const options: RequestInit = {
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  };
  const response = await fetch(path, options);
  if (response.status !== 401 || !(await refreshSession())) return response;
  options.signal!.throwIfAborted();
  return fetch(path, options);
}

export async function fetchSourceVersions(path: string): Promise<SourceHistory | null> {
  const response = await fetchHistoryRead(path);
  if (response.status === 404) return null;
  if (!response.ok) throw new VersionRequestError(response.status);
  return sourceHistorySchema.parse(await response.json());
}

export async function captureSourceVersion(conversationId: string, signal: AbortSignal, messageId?: string) {
  const response = await fetch('/api/platform/source-versions/snapshot', {
    method: 'POST',
    credentials: 'same-origin',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId, ...(messageId ? { messageId } : {}) }),
    signal,
  });
  if (!response.ok) {
    const failure: unknown = await response.json().catch((): null => null);
    const code =
      failure && typeof failure === 'object' && 'code' in failure && typeof failure.code === 'string'
        ? failure.code
        : undefined;
    throw new VersionRequestError(response.status, code);
  }
  const result = sourceHistorySchema
    .extend({ versionId: z.string().uuid(), messageId: id.optional() })
    .parse(await response.json());
  if (
    !result.configured ||
    !result.versions.some((version) => version.id === result.versionId) ||
    (messageId &&
      (result.messageId !== messageId ||
        !result.cards.some((card) => card.messageId === messageId && card.sourceVersionId === result.versionId)))
  ) {
    throw new VersionRequestError(502);
  }
  return result;
}

const historyPageSchema = z.object({
  items: z
    .array(
      z.object({
        id,
        type: z.string(),
        content: z.unknown(),
        position: z.string().nullable().optional(),
        hidden: z.boolean().optional(),
        created_at: z.number(),
      })
    )
    .max(10000),
  oldest_cursor: z.string().nullable().optional(),
  has_more_before: z.boolean().optional(),
});
export type HistoryPage = z.infer<typeof historyPageSchema>;

export const versionsPath = (conversationId: string): string =>
  `/api/platform/conversations/${encodeURIComponent(conversationId)}`;

export class VersionRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string
  ) {
    super('Version request failed');
  }
}

export async function fetchVersions(path: string): Promise<VersionHistory | null> {
  const response = await fetchHistoryRead(path);
  if (response.status === 404) return null;
  if (!response.ok) throw new VersionRequestError(response.status);
  return versionHistorySchema.parse(await response.json());
}

export async function restoreVersion(
  conversationId: string,
  revisionId: string,
  expectedGeneration: number,
  signal: AbortSignal
): Promise<VersionHistory> {
  const response = await fetch(`${versionsPath(conversationId)}/revisions/${encodeURIComponent(revisionId)}/restore`, {
    method: 'POST',
    credentials: 'same-origin',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedGeneration }),
    signal,
  });
  if (!response.ok) throw new VersionRequestError(response.status);
  const next = versionHistorySchema.parse(await response.json());
  if (next.activeRevisionId !== revisionId || next.headGeneration <= expectedGeneration)
    throw new VersionRequestError(502);
  return next;
}

export async function fetchRevertedMessages(path: string): Promise<HistoryPage> {
  const response = await fetchHistoryRead(path);
  if (!response.ok) throw new VersionRequestError(response.status);
  return historyPageSchema.parse(await response.json());
}

/** Historical previews use a trusted handoff or an explicit isolated URL, never the live app. */
export function versionPreviewUrl(version: SavedVersion | SourceVersion): string | undefined {
  const source = isSourceVersion(version);
  if ((source ? version.sourceKind !== 'static' : version.status !== 'ready') || !version.previewUrl) return;
  if (isHistoricalPreviewUrl(version.previewUrl, version.id, source ? 'source' : 'native')) {
    const url = new URL(version.previewUrl, window.location.origin);
    return url.href;
  }
  // Code versions must use their exact owner-bound handoff, never an alias or arbitrary external URL.
  if (source) return;
  try {
    const url = new URL(version.previewUrl);
    const local = url.hostname.endsWith('.localhost');
    if (
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
      url.username ||
      url.password ||
      url.origin === window.location.origin
    )
      return;
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return;
    return url.href;
  } catch {
    return;
  }
}

export function historicalMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object' && 'content' in content && typeof content.content === 'string')
    return content.content;
  return JSON.stringify(content, null, 2) ?? '';
}

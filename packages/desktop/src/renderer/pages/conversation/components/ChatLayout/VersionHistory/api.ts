import { z } from 'zod';

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
  constructor(readonly status: number) {
    super('Version request failed');
  }
}

export async function fetchVersions(path: string): Promise<VersionHistory | null> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
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
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new VersionRequestError(response.status);
  return historyPageSchema.parse(await response.json());
}

/** Historical previews must be explicit, isolated URLs, never live loopback links. */
export function versionPreviewUrl(version: SavedVersion): string | undefined {
  if (version.status !== 'ready' || !version.previewUrl) return;
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

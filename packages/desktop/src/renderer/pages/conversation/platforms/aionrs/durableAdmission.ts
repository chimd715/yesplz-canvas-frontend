import { z } from 'zod';
import type { TConversationRuntimeSummary } from '@/common/config/storage';
import { refreshSession } from '@/common/adapter/sessionRefresh';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const uuid = z.string().uuid();
export const requestContextSchema = z.object({
  logicalId: id,
  coreId: id,
  runtimeGeneration: uuid,
  headGeneration: z.number().int().nonnegative().safe(),
});
export const pendingRequestSchema = z.object({ requestId: uuid, context: requestContextSchema });
export type PendingNativeRequest = z.infer<typeof pendingRequestSchema>;
const capabilitySchema = z.discriminatedUnion('protocol', [
  z.object({ protocol: z.literal(0), ownerId: uuid, projectId: uuid }),
  requestContextSchema.extend({ protocol: z.literal(1), ownerId: uuid, projectId: uuid }),
]);
export type NativeAdmissionCapability = z.infer<typeof capabilitySchema> | { protocol: 0 };
const runtimeSchema = z
  .object({
    state: z.enum(['idle', 'starting', 'running', 'cancelling', 'restarting', 'waiting_confirmation']),
    can_send_message: z.boolean(),
    has_task: z.boolean(),
    task_status: z
      .enum(['pending', 'running', 'finished'])
      .nullable()
      .optional()
      .transform((value) => value ?? undefined),
    is_processing: z.boolean(),
    pending_confirmations: z.number().int().nonnegative(),
    turn_id: id.nullable(),
    supports_midturn_delivery: z.boolean().optional(),
  })
  .transform((value) => value as TConversationRuntimeSummary);
const acceptedSchema = z.object({
  requestId: uuid,
  context: requestContextSchema,
  prompt: z.object({ client_request_id: uuid, content: z.string(), hidden: z.boolean() }),
  receipt: z.object({ client_request_id: uuid, msg_id: id, turn_id: id }).nullable(),
  runtime: runtimeSchema.optional(),
});

export class NativeAdmissionError extends Error {
  constructor(readonly status: number) {
    super('Native request admission unavailable');
  }
}

const path = (coreId: string) => `/api/platform/conversations/${encodeURIComponent(coreId)}/requests`;
async function request(url: string, method = 'GET', body?: unknown): Promise<Response> {
  const options: RequestInit = {
    method,
    credentials: 'same-origin',
    redirect: 'error',
    cache: 'no-store',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  };
  let response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
  if (response.status === 401 && (await refreshSession()))
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
  return response;
}

export async function nativeAdmissionCapability(coreId: string): Promise<NativeAdmissionCapability> {
  // Standalone WebUI keeps its existing Core protocol. Hosted failures never
  // downgrade to a non-durable send.
  if (!document.querySelector('meta[name="ai-builder-preview"][content="enabled"]')) return { protocol: 0 };
  const response = await request(path(coreId));
  if (!response.ok) throw new NativeAdmissionError(response.status);
  const capability = capabilitySchema.parse(await response.json());
  if (capability.protocol === 1 && capability.coreId !== coreId) throw new NativeAdmissionError(409);
  return capability;
}

export async function submitNativeRequest(
  pending: PendingNativeRequest,
  content: string,
  action: 'send' | 'lookup' | 'reconcile'
) {
  const base = path(pending.context.coreId);
  const response = await request(
    action === 'send' ? base : `${base}/${pending.requestId}${action === 'reconcile' ? '/reconcile' : ''}`,
    action === 'lookup' ? 'GET' : 'POST',
    action === 'send'
      ? { context: pending.context, prompt: { client_request_id: pending.requestId, content, hidden: false } }
      : undefined
  );
  if (action === 'lookup' && response.status === 404) return null;
  if (!response.ok) throw new NativeAdmissionError(response.status);
  const accepted = acceptedSchema.parse(await response.json());
  if (
    accepted.requestId !== pending.requestId ||
    accepted.prompt.client_request_id !== pending.requestId ||
    accepted.prompt.content !== content ||
    accepted.prompt.hidden !== false ||
    JSON.stringify(accepted.context) !== JSON.stringify(pending.context) ||
    (accepted.receipt && accepted.receipt.client_request_id !== pending.requestId)
  )
    throw new NativeAdmissionError(502);
  return accepted;
}

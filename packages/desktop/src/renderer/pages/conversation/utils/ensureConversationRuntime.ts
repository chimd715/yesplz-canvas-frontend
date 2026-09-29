import { ipcBridge } from '@/common';
import { isNativeRuntimeActive, nativeRuntimeActivationEpoch } from '@/common/adapter/httpBridge';
import type { EnsureConversationRuntimeResponse } from '@/common/types/platform/acpTypes';

const ensureRuntimeByConversation = new Map<string, Promise<EnsureConversationRuntimeResponse>>();

export function ensureConversationRuntime(conversation_id: string): Promise<EnsureConversationRuntimeResponse> {
  if (!isNativeRuntimeActive()) return Promise.reject(new Error('Native runtime unavailable before resume'));
  const key = `${conversation_id}/${nativeRuntimeActivationEpoch()}`;
  const existing = ensureRuntimeByConversation.get(key);
  if (existing) {
    return existing;
  }

  const promise = ipcBridge.conversation.ensureRuntime.invoke({ conversation_id }).finally(() => {
    ensureRuntimeByConversation.delete(key);
  });
  ensureRuntimeByConversation.set(key, promise);
  return promise;
}

export function resetEnsureConversationRuntimeStateForTests(): void {
  ensureRuntimeByConversation.clear();
}

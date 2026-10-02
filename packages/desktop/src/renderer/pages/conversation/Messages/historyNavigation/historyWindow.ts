import type { TMessage } from '@/common/chat/chatLib';
import { preferTextMessageVersion } from '@/common/chat/chatLib';
import { foldSupersededTips } from '../hooks';

/** Runtime and persisted rows use different IDs for the same protocol message. */
export function historyMessageKey(message: TMessage): string {
  if (message.type === 'tool_call' && message.content.call_id) return `tool:${message.content.call_id}`;
  if (message.type === 'acp_tool_call' && message.content.update?.tool_call_id)
    return `acp-tool:${message.content.update.tool_call_id}`;
  if (message.type === 'acp_terminal_output' && message.content.terminal_id)
    return `terminal:${message.content.terminal_id}`;
  if (message.type === 'permission' && message.content.call_id) return `permission:${message.content.call_id}`;
  return message.msg_id ? `${message.type}:${message.msg_id}` : `id:${message.id}`;
}

/** Replace a history window without retaining unrelated, previously loaded pages. */
export function replaceHistoryWindow(
  conversationId: string,
  incoming: TMessage[],
  current: TMessage[],
  latestSnapshotKeys?: ReadonlyMap<string, TMessage>
): TMessage[] {
  const byId = new Map(
    current.filter((message) => message.conversation_id === conversationId).map((message) => [message.id, message])
  );
  const incomingIds = new Set(incoming.map((message) => message.id));
  const incomingKeys = new Set(incoming.map(historyMessageKey));
  const byKey = new Map(
    current
      .filter((message) => message.conversation_id === conversationId)
      .map((message) => [historyMessageKey(message), message])
  );
  const bounded = incoming
    .filter((message) => message.conversation_id === conversationId)
    .map((message) => {
      const live = byId.get(message.id) ?? byKey.get(historyMessageKey(message));
      if (live?.type === 'text' && message.type === 'text') {
        const preferred = preferTextMessageVersion(message, live);
        return latestSnapshotKeys && latestSnapshotKeys.get(historyMessageKey(live)) !== live
          ? Object.assign({}, preferred, { status: live.status ?? preferred.status })
          : preferred;
      }
      // An in-place tool/thinking/status update received during this request
      // must outrank the older database snapshot for that same protocol row.
      if (live && latestSnapshotKeys && latestSnapshotKeys.get(historyMessageKey(live)) !== live) return live;
      return message;
    });
  // A latest-page read may race a live frame. Keep only frames received after
  // that read began, never the older pages that happened to be on screen.
  if (latestSnapshotKeys) {
    bounded.push(
      ...current.filter(
        (message) =>
          message.conversation_id === conversationId &&
          !incomingIds.has(message.id) &&
          !incomingKeys.has(historyMessageKey(message)) &&
          !latestSnapshotKeys.has(historyMessageKey(message))
      )
    );
  }
  return foldSupersededTips(bounded);
}

/** Append an adjacent cursor page without duplicates or unrelated conversations. */
export function appendHistoryPage(conversationId: string, current: TMessage[], incoming: TMessage[]): TMessage[] {
  const ids = new Set(current.map((message) => message.id));
  const keys = new Set(current.map(historyMessageKey));
  const incomingByKey = new Map(
    incoming
      .filter((message) => message.conversation_id === conversationId)
      .map((message) => [historyMessageKey(message), message])
  );
  const merged = current.map((message) => {
    const persisted = incomingByKey.get(historyMessageKey(message));
    return message.type === 'text' && persisted?.type === 'text'
      ? preferTextMessageVersion(persisted, message)
      : message;
  });
  return foldSupersededTips([
    ...merged,
    ...incoming.filter(
      (message) =>
        message.conversation_id === conversationId && !ids.has(message.id) && !keys.has(historyMessageKey(message))
    ),
  ]);
}

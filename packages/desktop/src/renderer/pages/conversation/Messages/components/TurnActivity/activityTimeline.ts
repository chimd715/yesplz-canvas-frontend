import type { TMessage } from '@/common/chat/chatLib';
import { normalizeToolMessages, type NormalizedToolCall } from '@/common/chat/normalizeToolCall';
import type { ActivityMessage, ActivityTimelineItem, TurnActivitySummary } from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

// These operations have their own secure/question UI. Neither their arguments
// nor their results belong in an expandable activity transcript.
const isSeparateInteraction = (name: unknown): boolean => {
  if (typeof name !== 'string') return false;
  const leaf = name
    .split(/__|[.:/]/)
    .at(-1)
    ?.toLowerCase();
  return ['askuserquestion', 'request_secret', 'get_secret_status', 'github_identity'].includes(leaf ?? '');
};

export const sanitizeActivityMessage = (message: TMessage): ActivityMessage | undefined => {
  if (message.hidden || (!isRecord(message.content) && message.type !== 'tool_group')) return undefined;
  if (message.type === 'thinking') {
    return typeof message.content.content === 'string' &&
      (message.content.subject == null || typeof message.content.subject === 'string')
      ? message
      : undefined;
  }
  if (message.type === 'agent_status') {
    return typeof message.content.backend === 'string' &&
      ['connecting', 'connected', 'authenticated', 'session_active', 'error'].includes(message.content.status) &&
      (message.content.agent_name == null || typeof message.content.agent_name === 'string')
      ? message
      : undefined;
  }
  if (message.type === 'tool_call') {
    return typeof message.content.name !== 'string' ||
      typeof message.content.call_id !== 'string' ||
      !message.content.call_id.trim() ||
      isSeparateInteraction(message.content.name)
      ? undefined
      : message;
  }
  if (message.type === 'acp_tool_call') {
    return !isRecord(message.content.update) ||
      typeof message.content.update.tool_call_id !== 'string' ||
      typeof message.content.update.title !== 'string' ||
      isSeparateInteraction(message.content.update.title)
      ? undefined
      : message;
  }
  if (message.type === 'tool_group' && Array.isArray(message.content)) {
    const content = message.content.filter(
      (tool) =>
        isRecord(tool) &&
        typeof tool.name === 'string' &&
        typeof tool.call_id === 'string' &&
        !isSeparateInteraction(tool.name) &&
        !isSeparateInteraction(
          tool.confirmationDetails?.type === 'mcp' ? tool.confirmationDetails.tool_name : undefined
        )
    );
    return content.length ? { ...message, content } : undefined;
  }
  return undefined;
};

export const getActivityTools = (message: ActivityMessage): NormalizedToolCall[] =>
  message.type === 'thinking' || message.type === 'agent_status'
    ? []
    : normalizeToolMessages([message])
        .filter((tool) => typeof tool.name === 'string' && typeof tool.key === 'string')
        .map((tool) => {
          // Normalization creates fresh objects; discard malformed output safely.
          if (typeof tool.output !== 'string') tool.output = undefined;
          return tool;
        });

/** Project only the loaded history window; never collect live rows elsewhere.
 * Core mints separate msg_ids for text/thinking segments and persisted tools.
 * Every segment between two user messages belongs to the same customer turn.
 * A partial window begins with one partial turn until its first user boundary.
 */
export const projectTurnActivities = (
  messages: TMessage[],
  { isProcessing = false, atLatest = true }: { isProcessing?: boolean; atLatest?: boolean } = {}
): ActivityTimelineItem[] => {
  const result: ActivityTimelineItem[] = [];
  const summaries = new Map<string, TurnActivitySummary>();
  let boundary = 'history-start';
  let latestTurn: string | undefined;

  for (const message of messages) {
    if (message.hidden || ['ask', 'plan', 'available_commands'].includes(message.type)) continue;
    if (message.position === 'right') {
      boundary = message.msg_id || message.id;
      latestTurn = undefined;
      result.push(message);
      continue;
    }
    const turnKey = `${message.conversation_id}:${boundary}`;
    latestTurn = turnKey;
    const activity = sanitizeActivityMessage(message);
    if (!activity) {
      // Formal/secure tools must not fall back to ordinary message rendering.
      if (!['thinking', 'agent_status', 'tool_call', 'tool_group', 'acp_tool_call'].includes(message.type)) {
        result.push(message);
      }
      continue;
    }
    let summary = summaries.get(turnKey);
    if (!summary) {
      summary = {
        type: 'activity_summary',
        id: `activity:${turnKey}`,
        messages: [],
        sourceMessageIds: [],
        created_at: message.created_at ?? 0,
        active: false,
      };
      summaries.set(turnKey, summary);
      result.push(summary);
    }
    summary.messages.push(activity);
    summary.sourceMessageIds.push(message.id);
  }
  const current = latestTurn && summaries.get(latestTurn);
  if (current && atLatest && isProcessing) current.active = true;
  return result;
};

export const latestActivityMessage = (summary: TurnActivitySummary): ActivityMessage =>
  summary.messages.reduce((latest, message) =>
    (message.activity_updated_at ?? message.created_at ?? 0) >= (latest.activity_updated_at ?? latest.created_at ?? 0)
      ? message
      : latest
  );

export const hasCurrentTurnActivity = (messages: TMessage[]): boolean =>
  projectTurnActivities(messages, { isProcessing: true }).some(
    (item) => item.type === 'activity_summary' && item.active
  );

import type { IMessageAgentStatus, IMessageThinking, TMessage } from '@/common/chat/chatLib';
import type { ToolMessage } from '@/common/chat/normalizeToolCall';

export type ActivityMessage = IMessageThinking | IMessageAgentStatus | ToolMessage;

export interface TurnActivitySummary {
  type: 'activity_summary';
  id: string;
  messages: ActivityMessage[];
  sourceMessageIds: string[];
  created_at: number;
  active: boolean;
}

export type ActivityTimelineItem = TMessage | TurnActivitySummary;

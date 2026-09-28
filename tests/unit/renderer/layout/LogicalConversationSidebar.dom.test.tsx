/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import type { ConversationHistoryContextValue } from '@/renderer/hooks/context/ConversationHistoryContext';
import type { ConversationRowProps } from '@/renderer/pages/conversation/GroupedHistory/types';
import { act, render, renderHook, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  routeId: 'logical-chat',
  context: undefined as ConversationHistoryContextValue | undefined,
  cronActive: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: mocks.routeId }),
  useNavigate: () => vi.fn(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/renderer/hooks/context/ConversationHistoryContext', () => ({
  useConversationHistoryContext: () => mocks.context,
}));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => ({ isMobile: false }) }));
vi.mock('@/renderer/pages/cron', () => ({
  useCronJobsMap: () => ({ getJobStatus: () => 'none', markAsRead: vi.fn(), setActiveConversation: mocks.cronActive }),
}));
vi.mock('@/renderer/components/base/AionModal', () => ({ default: () => null }));
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useConversationActions', () => ({
  useConversationActions: () => ({}),
}));
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useDragAndDrop', () => ({
  useDragAndDrop: () => ({ isDragEnabled: false }),
}));
vi.mock('@/renderer/pages/conversation/GroupedHistory/ConversationRow', () => ({
  default: ({ selected, isGenerating, conversation }: ConversationRowProps) => (
    <div data-testid='row' data-selected={selected} data-generating={isGenerating}>
      {conversation.name}
    </div>
  ),
}));

import GroupedHistory from '@/renderer/pages/conversation/GroupedHistory';
import { useConversations } from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversations';
import { buildVisibleConversationIds } from '@/renderer/pages/conversation/GroupedHistory/utils/visibleConversationOrder';

const conversation = {
  id: 'active-core',
  logical_conversation_id: 'logical-chat',
  head_generation: 2,
  name: 'Saved chat',
  type: 'aionrs',
  extra: {},
  created_at: 1,
  modified_at: 1,
} as TChatConversation;

describe('logical sidebar identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.routeId = 'logical-chat';
    mocks.context = {
      conversations: [conversation],
      groupedHistory: { pinnedConversations: [conversation], timelineSections: [] },
      isConversationGenerating: vi.fn((id: string) => id === 'active-core'),
      isConversationWaitingConfirmation: () => false,
      hasCompletionUnread: () => false,
      isManualUnread: () => false,
      clearCompletionUnread: vi.fn(),
      clearManualUnread: vi.fn(),
      markManualUnread: vi.fn(),
      setActiveConversation: vi.fn(),
    } as unknown as ConversationHistoryContextValue;
  });

  afterEach(() => vi.unstubAllGlobals());

  it('highlights the logical route while reading native stream and cron activity', () => {
    render(<GroupedHistory />);

    expect(screen.getByTestId('row')).toHaveAttribute('data-selected', 'true');
    expect(screen.getByTestId('row')).toHaveAttribute('data-generating', 'true');
    expect(mocks.cronActive).toHaveBeenCalledWith('active-core');
  });

  it('keeps unrelated routes unselected', () => {
    mocks.routeId = 'another-chat';
    render(<GroupedHistory />);

    expect(screen.getByTestId('row')).toHaveAttribute('data-selected', 'false');
  });

  it('reveals the logical scroll target and clears unread state for the active Core conversation', () => {
    localStorage.setItem('grouped-history-collapsed-sections', JSON.stringify(['pinned']));
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const target = document.createElement('div');
    target.id = 'c-logical-chat';
    target.scrollIntoView = vi.fn();
    document.body.appendChild(target);
    const { result } = renderHook(() => useConversations());

    act(() => {
      while (frames.length) frames.shift()!(0);
    });

    expect(result.current.collapsedSections.has('pinned')).toBe(false);
    expect(target.scrollIntoView).toHaveBeenCalled();
    expect(mocks.context?.clearCompletionUnread).toHaveBeenCalledWith('active-core');
    target.remove();
  });

  it('uses logical IDs for keyboard navigation with a native fallback for legacy rows', () => {
    const legacy = { ...conversation, id: 'legacy', logical_conversation_id: undefined };
    const ids = buildVisibleConversationIds({
      pinnedConversations: [conversation],
      timelineSections: [{ timeline: 'today', items: [{ type: 'conversation', time: 1, conversation: legacy }] }],
      expandedWorkspaces: [],
      siderCollapsed: false,
    });

    expect(ids).toEqual(['logical-chat', 'legacy']);
  });
});

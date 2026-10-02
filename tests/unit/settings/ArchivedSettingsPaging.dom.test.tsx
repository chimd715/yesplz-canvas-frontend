/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Message, Modal } from '@arco-design/web-react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { getMock, itemsMock, deleteMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  itemsMock: vi.fn(),
  deleteMock: vi.fn(),
}));

// The component reads `ipcBridge` from `@/common`. Only the sidebar surface is
// exercised here; the mutation endpoints are stubbed so per-row buttons render.
vi.mock('@/common', () => ({
  ipcBridge: {
    sidebar: {
      get: { invoke: getMock },
      items: { invoke: itemsMock },
      unarchive: { invoke: vi.fn(() => Promise.resolve()) },
      deleteArchivedItem: { invoke: deleteMock },
      deleteArchivedProject: { invoke: vi.fn(() => Promise.resolve()) },
    },
  },
}));

// Keep the real `scopeToToken` — the token grammar it produces is exactly what
// the paging assertions verify. Only i18n / logos / passthrough shells are mocked.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && 'count' in opts ? `${key}:${String(opts.count)}` : key,
    i18n: { language: 'en-US' },
  }),
}));

vi.mock('@/renderer/utils/model/agentLogo', () => ({ useAgentLogos: () => ({}) }));

vi.mock('@/renderer/utils/emitter', () => ({ emitter: { emit: vi.fn() } }));

vi.mock('@/renderer/pages/conversation/utils/conversationAssistantIdentity', () => ({
  resolveConversationLeadingMark: () => ({ kind: 'assistant_fallback' as const }),
}));

vi.mock('@/renderer/pages/settings/components/SettingsPageWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/renderer/pages/settings/components/SettingsPageHeader', () => ({
  default: ({ title, actions }: { title: React.ReactNode; actions?: React.ReactNode }) => (
    <div>
      <div>{title}</div>
      <div>{actions}</div>
    </div>
  ),
}));

import ArchivedSettings from '@/renderer/pages/settings/ArchivedSettings';

type Conv = { id: string; name: string; created_at: number };

const conv = (id: string, name: string): { type: 'conversation'; conversation: Conv } => ({
  type: 'conversation',
  conversation: { id, name, created_at: 1_700_000_000_000 },
});

/** A project group with the given items / paging signals. */
const projectGroup = (
  projectId: string,
  name: string,
  items: ReturnType<typeof conv>[],
  hasMore: boolean,
  nextCursor?: string
) => ({
  scope: { type: 'project' as const, project_id: projectId, name },
  items,
  has_more: hasMore,
  next_cursor: nextCursor,
});

const renderPage = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ArchivedSettings />
    </SWRConfig>
  );

describe('ArchivedSettings paging', () => {
  beforeEach(() => {
    vi.spyOn(Message, 'success').mockImplementation(vi.fn());
    vi.spyOn(Message, 'error').mockImplementation(vi.fn());
    getMock.mockReset();
    itemsMock.mockReset();
    deleteMock.mockReset();
    deleteMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('requests the first screen with an explicit page-size limit and the archived flag', async () => {
    getMock.mockResolvedValue({
      groups: [projectGroup('P1', 'Alpha', [conv('c1', 'Chat One')], false)],
      has_more_groups: false,
    });

    renderPage();

    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(getMock).toHaveBeenCalledWith({ archived: true, limit: 5 });
    // A fully-loaded group (has_more false) shows no "load more" affordance.
    await screen.findByText('Chat One');
    expect(screen.queryByText('settings.archived.loadMore')).toBeNull();
  });

  it('renders a load-more button only for a group with more archived items', async () => {
    getMock.mockResolvedValue({
      groups: [projectGroup('P1', 'Alpha', [conv('c1', 'Chat One')], true, 'cursor-1')],
      has_more_groups: false,
    });

    renderPage();

    await screen.findByText('Chat One');
    expect(screen.getByText('settings.archived.loadMore')).toBeTruthy();
  });

  it('pages the group via sidebar.items with the derived scope token, appends the window, and clears the button when drained', async () => {
    getMock.mockResolvedValue({
      groups: [projectGroup('P1', 'Alpha', [conv('c1', 'Chat One')], true, 'cursor-1')],
      has_more_groups: false,
    });
    itemsMock.mockResolvedValue({ items: [conv('c2', 'Chat Two')], has_more: false, next_cursor: undefined });

    renderPage();

    fireEvent.click(await screen.findByText('settings.archived.loadMore'));

    await screen.findByText('Chat Two');
    expect(itemsMock).toHaveBeenCalledWith({ scope: 'project:P1', cursor: 'cursor-1', limit: 10, archived: true });
    // Both the first-screen and appended rows are present…
    expect(screen.getByText('Chat One')).toBeTruthy();
    // …and with the group drained, the button is gone.
    await waitFor(() => expect(screen.queryByText('settings.archived.loadMore')).toBeNull());
  });

  it('keeps paging when the appended window still reports more', async () => {
    getMock.mockResolvedValue({
      groups: [projectGroup('P1', 'Alpha', [conv('c1', 'Chat One')], true, 'cursor-1')],
      has_more_groups: false,
    });
    itemsMock.mockResolvedValue({ items: [conv('c2', 'Chat Two')], has_more: true, next_cursor: 'cursor-2' });

    renderPage();

    fireEvent.click(await screen.findByText('settings.archived.loadMore'));

    await screen.findByText('Chat Two');
    // Still more to page: the next click carries the advanced cursor.
    fireEvent.click(screen.getByText('settings.archived.loadMore'));
    await waitFor(() =>
      expect(itemsMock).toHaveBeenLastCalledWith({ scope: 'project:P1', cursor: 'cursor-2', limit: 10, archived: true })
    );
  });
  it('hides a successfully deleted archived row while the refresh is still pending, including a stale refresh', async () => {
    const stale = {
      groups: [
        projectGroup(
          'P1',
          'Alpha',
          [conv('deleted-archive', 'Deleted archive'), conv('kept-archive', 'Kept archive')],
          false
        ),
      ],
    };
    getMock.mockResolvedValueOnce(stale);
    const modal = vi.spyOn(Modal, 'confirm').mockReturnValue({ close: vi.fn(), update: vi.fn() });
    renderPage();
    await screen.findByText('Deleted archive');
    let finish!: (value: unknown) => void;
    getMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'settings.archived.delete' })[0]);
    let pending!: Promise<void>;
    await act(async () => {
      pending = modal.mock.calls[0][0].onOk!() as Promise<void>;
    });
    expect(deleteMock).toHaveBeenCalledWith({ item_type: 'conversation', item_id: 'deleted-archive' });
    expect(screen.queryByText('Deleted archive')).toBeNull();
    expect(screen.getByText('Kept archive')).toBeTruthy();
    await act(async () => {
      finish(stale);
      await pending;
    });
    expect(screen.queryByText('Deleted archive')).toBeNull();
  });

  it('keeps an archived row visible when its delete request fails', async () => {
    getMock.mockResolvedValue({
      groups: [projectGroup('P1', 'Alpha', [conv('failed-delete', 'Still present')], false)],
    });
    deleteMock.mockRejectedValue(new Error('request failed'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const modal = vi.spyOn(Modal, 'confirm').mockReturnValue({ close: vi.fn(), update: vi.fn() });
    renderPage();
    await screen.findByText('Still present');
    fireEvent.click(screen.getByRole('button', { name: 'settings.archived.delete' }));
    await act(async () => {
      await modal.mock.calls[0][0].onOk!();
    });
    expect(screen.getByText('Still present')).toBeTruthy();
    expect(getMock).toHaveBeenCalledTimes(1);
  });
});

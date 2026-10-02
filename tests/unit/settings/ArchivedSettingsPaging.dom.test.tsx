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

const { getMock, itemsMock, deleteMock, restoreMock, emitMock, account } = vi.hoisted(() => ({
  getMock: vi.fn(),
  itemsMock: vi.fn(),
  deleteMock: vi.fn(),
  restoreMock: vi.fn(),
  emitMock: vi.fn(),
  account: { id: 'user-a' as string | null },
}));

// The component reads `ipcBridge` from `@/common`. Only the sidebar surface is
// exercised here; the mutation endpoints are stubbed so per-row buttons render.
vi.mock('@/common', () => ({
  ipcBridge: {
    sidebar: {
      get: { invoke: getMock },
      items: { invoke: itemsMock },
      unarchive: { invoke: restoreMock },
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

vi.mock('@/renderer/utils/emitter', () => ({ emitter: { emit: emitMock } }));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({
    user: account.id ? { id: account.id } : null,
    status: account.id ? 'authenticated' : 'unauthenticated',
  }),
}));

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
    account.id = 'user-a';
    emitMock.mockClear();
    restoreMock.mockReset().mockResolvedValue(undefined);
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

  it.each([false, true])('ignores a pending old-account delete after login changes (batch: %s)', async (batch) => {
    getMock.mockResolvedValueOnce({
      groups: [
        projectGroup(
          'owner-project',
          'Owner project',
          [conv('old-owner-delete', 'Old owner title'), conv('kept', 'Keep')],
          false
        ),
      ],
    });
    let finish!: () => void;
    deleteMock.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      })
    );
    const modal = vi.spyOn(Modal, 'confirm').mockReturnValue({ close: vi.fn(), update: vi.fn() });
    const view = renderPage();
    await screen.findByText('Old owner title');
    if (batch) {
      fireEvent.click(screen.getByRole('button', { name: 'settings.archived.multiSelect' }));
      fireEvent.click(screen.getByText('Old owner title'));
      fireEvent.click(screen.getByRole('button', { name: 'settings.archived.deleteSelected' }));
    } else {
      fireEvent.click(screen.getAllByRole('button', { name: 'settings.archived.delete' })[0]);
    }
    let pending!: Promise<void>;
    act(() => {
      pending = modal.mock.calls[0][0].onOk!() as Promise<void>;
    });
    getMock.mockResolvedValueOnce({ groups: [] });
    account.id = 'user-b';
    view.rerender(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ArchivedSettings />
      </SWRConfig>
    );
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
    await act(async () => {
      finish();
      await pending;
    });
    expect(screen.queryByText('Old owner title')).toBeNull();
    expect(emitMock).not.toHaveBeenCalled();
    expect(Message.success).not.toHaveBeenCalled();
    expect(Message.error).not.toHaveBeenCalled();
    expect(getMock).toHaveBeenCalledTimes(2);
  });
});

describe('ArchivedSettings immediate restore', () => {
  beforeEach(() => {
    account.id = 'user-a';
    getMock.mockReset();
    itemsMock.mockReset();
    restoreMock.mockReset().mockResolvedValue(undefined);
    emitMock.mockClear();
    vi.spyOn(Message, 'success').mockImplementation(vi.fn());
    vi.spyOn(Message, 'error').mockImplementation(vi.fn());
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('hides the restored row and refreshes active history before archived revalidation finishes', async () => {
    const stale = {
      groups: [
        projectGroup(
          'P-restore',
          'Restore',
          [conv('restore-now', 'Restore now'), conv('restore-kept', 'Keep archived')],
          false
        ),
      ],
      has_more_groups: false,
    };
    getMock.mockResolvedValueOnce(stale);
    renderPage();
    await screen.findByText('Restore now');
    let finish!: (value: unknown) => void;
    getMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'settings.archived.restore' })[0]);
    await waitFor(() => expect(screen.queryByText('Restore now')).toBeNull());
    expect(screen.getByText('Keep archived')).toBeTruthy();
    expect(emitMock).toHaveBeenCalledWith('chat.history.refresh');
    await act(async () =>
      finish({
        groups: [projectGroup('P-restore', 'Restore', [conv('restore-kept', 'Keep archived')], false)],
        has_more_groups: false,
      })
    );
    expect(screen.queryByText('Restore now')).toBeNull();
  });

  it('keeps the row and reports failure when the restore mutation is rejected', async () => {
    getMock.mockResolvedValue({
      groups: [projectGroup('P-failed', 'Failed', [conv('restore-failed', 'Failed restore')], false)],
    });
    restoreMock.mockRejectedValue(new Error('mutation failed'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'settings.archived.restore' }));
    await waitFor(() => expect(Message.error).toHaveBeenCalledWith('settings.archived.restoreFailed'));
    expect(screen.getByText('Failed restore')).toBeTruthy();
    expect(emitMock).not.toHaveBeenCalled();
  });

  it('keeps a confirmed restore when background revalidation fails', async () => {
    getMock.mockResolvedValueOnce({
      groups: [projectGroup('P-outage', 'Outage', [conv('restore-outage', 'Restore during outage')], false)],
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPage();
    await screen.findByText('Restore during outage');
    getMock.mockRejectedValueOnce(new Error('refresh failed'));
    fireEvent.click(screen.getByRole('button', { name: 'settings.archived.restore' }));
    await waitFor(() => expect(screen.queryByText('Restore during outage')).toBeNull());
    expect(Message.success).toHaveBeenCalledWith('settings.archived.restoreSuccess');
    expect(Message.error).not.toHaveBeenCalled();
  });

  it('discards an older load-more window after a restore invalidates its cursor', async () => {
    const initial = {
      groups: [
        projectGroup(
          'P-late',
          'Late',
          [conv('restore-late', 'Restore first'), conv('restore-remains', 'Remains archived')],
          true,
          'old-cursor'
        ),
      ],
    };
    getMock.mockResolvedValue(initial);
    let finishPage!: (value: unknown) => void;
    itemsMock.mockReturnValue(
      new Promise((resolve) => {
        finishPage = resolve;
      })
    );
    renderPage();
    fireEvent.click(await screen.findByText('settings.archived.loadMore'));
    getMock.mockResolvedValue({
      groups: [projectGroup('P-late', 'Late', [conv('restore-remains', 'Remains archived')], false)],
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'settings.archived.restore' })[0]);
    await waitFor(() => expect(screen.queryByText('Restore first')).toBeNull());
    await act(async () => finishPage({ items: [conv('old-page', 'Stale paged title')], has_more: false }));
    expect(screen.queryByText('Stale paged title')).toBeNull();
    expect(screen.getByText('Remains archived')).toBeTruthy();
  });

  it('does not show the previous account cached page or apply its pending restore after account change', async () => {
    getMock.mockResolvedValueOnce({
      groups: [projectGroup('P-private', 'Private', [conv('private-account-a', 'Private account A title')], false)],
    });
    let finishRestore!: () => void;
    restoreMock.mockReturnValue(
      new Promise<void>((resolve) => {
        finishRestore = resolve;
      })
    );
    const view = renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'settings.archived.restore' }));
    getMock.mockReturnValueOnce(new Promise(() => {}));
    account.id = 'user-b';
    view.rerender(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ArchivedSettings />
      </SWRConfig>
    );
    expect(screen.queryByText('Private account A title')).toBeNull();
    await act(async () => finishRestore());
    expect(emitMock).not.toHaveBeenCalled();
    expect(Message.success).not.toHaveBeenCalled();
  });
});

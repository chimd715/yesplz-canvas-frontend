/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Guards the project_id backfill path (卡点①, responsive / no-poll): opening a
 * workspace conversation lazily backfills its project_id server-side; the first
 * GET can land on the pre-backfill row (project_id null). The backend emits one
 * `conversation.listChanged` (action 'updated') when the backfill lands; the
 * conversation route must refetch on that event so the now-populated project_id
 * reaches the currentProject store (→ the Explorer host appears). No polling.
 */

import React from 'react';
import { render, waitFor, cleanup, screen, fireEvent } from '@testing-library/react';
import { act } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IConversationListChangedEvent } from '@/common/adapter/ipcBridge';
import type { TChatConversation } from '@/common/config/storage';
import { BackendHttpError, type NativeRuntimeContext } from '@/common/adapter/httpBridge';

const nativeActivation = vi.hoisted(() => ({
  context: null as NativeRuntimeContext | null,
  epoch: 0,
  suspend: vi.fn(),
}));
vi.mock('@/common/adapter/httpBridge', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getBuilderWorkspace: () =>
    nativeActivation.context
      ? {
          mode: 'central-read',
          ownerId: nativeActivation.context.ownerId,
          projectId: nativeActivation.context.projectId,
        }
      : null,
  getActiveNativeRuntimeContext: () => nativeActivation.context,
  nativeRuntimeActivationEpoch: () => nativeActivation.epoch,
  subscribeNativeRuntimeActivation: () => () => {},
  suspendNativeRuntime: nativeActivation.suspend,
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'c1' }),
  useNavigate: () => vi.fn(),
}));
vi.mock('@/renderer/pages/conversation/components/ChatConversation', () => ({
  default: ({ conversation }: { conversation?: TChatConversation }) => <div data-testid='chat'>{conversation?.id}</div>,
}));
vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({ closePreviewIfScopeChanged: vi.fn() }),
}));
vi.mock('@/renderer/hooks/chat/useAutoTitle', () => ({ useAutoTitle: () => ({ syncTitleFromHistory: vi.fn() }) }));

// getConversationOrNull is the fetcher; sequence null-project → backfilled.
const getConversationOrNull = vi.fn<(id: string) => Promise<TChatConversation | null>>();
vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: (id: string) => getConversationOrNull(id),
}));

// Capture the listChanged listener so the test can fire the backend event.
let listChangedCb: ((e: IConversationListChangedEvent) => void) | null = null;
vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      listChanged: {
        on: (cb: (e: IConversationListChangedEvent) => void) => {
          listChangedCb = cb;
          return () => {
            listChangedCb = null;
          };
        },
      },
    },
  },
}));

import ChatConversationIndex from '@/renderer/pages/conversation/index';
import {
  getCurrentProject,
  resetCurrentProjectForTest,
} from '@/renderer/pages/conversation/explorer/currentProjectStore';

const conv = (project_id: string | null): TChatConversation =>
  ({ id: 'c1', name: 'x', type: 'acp', extra: { workspace: '/w' }, project_id }) as unknown as TChatConversation;

let refreshCached: ReturnType<typeof useSWRConfig>['mutate'];
const CacheAccess = () => {
  refreshCached = useSWRConfig().mutate;
  return null;
};

const renderIndex = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <CacheAccess />
      <ChatConversationIndex />
    </SWRConfig>
  );

beforeEach(() => {
  resetCurrentProjectForTest();
  getConversationOrNull.mockReset();
  listChangedCb = null;
});
afterEach(() => {
  cleanup();
  document.querySelector('meta[name="ai-builder-preview"]')?.remove();
  vi.unstubAllGlobals();
});

describe('conversation project_id backfill — responsive refetch on listChanged', () => {
  it('refetches on the backfill event and publishes the populated project_id (no poll)', async () => {
    // First GET → pre-backfill (null); after the event, GET → backfilled.
    getConversationOrNull.mockResolvedValueOnce(conv(null)).mockResolvedValue(conv('p1'));
    renderIndex();

    // Initial load: workspace conv with no project_id yet → currentProject stays null.
    await waitFor(() => expect(getConversationOrNull).toHaveBeenCalledTimes(1));
    expect(getCurrentProject()).toBeNull();

    // Backend emits the one-shot backfill event for THIS conversation.
    await act(async () => {
      listChangedCb?.({ conversation_id: 'c1', action: 'updated' } as IConversationListChangedEvent);
    });

    // Refetch fires → backfilled project_id flows to the store → host would render.
    await waitFor(() => expect(getCurrentProject()).toBe('p1'));
  });

  it('keeps an already loaded conversation visible when a background detail refresh returns 503', async () => {
    getConversationOrNull.mockResolvedValueOnce(conv('p1')).mockRejectedValue(
      new BackendHttpError({
        method: 'GET',
        path: '/api/conversations/c1',
        status: 503,
        body: { error: 'Temporarily unavailable' },
      })
    );
    renderIndex();
    await waitFor(() => expect(screen.getByTestId('chat')).toHaveTextContent('c1'));
    await act(async () => {
      listChangedCb?.({ conversation_id: 'c1', action: 'updated' } as IConversationListChangedEvent);
    });
    await waitFor(() => expect(getConversationOrNull).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('chat')).toHaveTextContent('c1');
    expect(screen.getByRole('alert')).toHaveTextContent('conversation.versions.unavailable');
    getConversationOrNull.mockResolvedValue(conv('p1'));
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByTestId('chat')).toHaveTextContent('c1');
  });

  it.each([401, 403])('does not retain an interactive cached conversation after a %s denial', async (status) => {
    getConversationOrNull.mockResolvedValueOnce(conv('p1')).mockRejectedValue(
      new BackendHttpError({
        method: 'GET',
        path: '/api/conversations/c1',
        status,
        body: { error: 'Denied' },
      })
    );
    renderIndex();
    await waitFor(() => expect(screen.getByTestId('chat')).toHaveTextContent('c1'));
    await act(async () => {
      listChangedCb?.({ conversation_id: 'c1', action: 'updated' } as IConversationListChangedEvent);
    });
    await waitFor(() => expect(screen.queryByTestId('chat')).not.toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent('conversation.versions.unavailable');
  });

  it('still blocks a first conversation load when no cached detail is available', async () => {
    getConversationOrNull.mockRejectedValue(
      new BackendHttpError({
        method: 'GET',
        path: '/api/conversations/c1',
        status: 503,
        body: { error: 'Unavailable' },
      })
    );
    renderIndex();
    await screen.findByRole('alert');
    expect(screen.queryByTestId('chat')).not.toBeInTheDocument();
  });

  it('ignores a listChanged event for a different conversation (no refetch)', async () => {
    getConversationOrNull.mockResolvedValue(conv(null));
    renderIndex();
    await waitFor(() => expect(getConversationOrNull).toHaveBeenCalledTimes(1));

    await act(async () => {
      listChangedCb?.({ conversation_id: 'other', action: 'updated' } as IConversationListChangedEvent);
    });

    // No extra fetch for a non-matching id; project stays null.
    await new Promise((r) => setTimeout(r, 50));
    expect(getConversationOrNull).toHaveBeenCalledTimes(1);
    expect(getCurrentProject()).toBeNull();
  });
});

describe('logical conversation routing', () => {
  const enableVersions = () => {
    vi.stubGlobal('electronAPI', undefined);
    const meta = document.createElement('meta');
    meta.name = 'ai-builder-preview';
    meta.content = 'enabled';
    document.head.append(meta);
  };
  it('suspends an old activation when the authoritative same logical conversation resolves to another Core continuation', async () => {
    enableVersions();
    nativeActivation.context = {
      ownerId: '11111111-1111-4111-8111-111111111111',
      projectId: '22222222-2222-4222-8222-222222222222',
      logicalId: 'same-logical',
      coreId: 'old-core',
      runtimeGeneration: '33333333-3333-4333-8333-333333333333',
      headGeneration: 1,
    };
    nativeActivation.suspend.mockClear();
    getConversationOrNull.mockResolvedValue({
      ...conv(null),
      id: 'new-core',
      logical_conversation_id: 'same-logical',
      head_generation: 2,
      runtime_generation: '44444444-4444-4444-8444-444444444444',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input) =>
        String(input).includes('/source-versions?')
          ? Response.json({ configured: false, versions: [], cards: [] })
          : Response.json({
              activeCoreConversationId: 'new-core',
              activeRevisionId: null,
              headGeneration: 2,
              versions: [],
              reverted: [],
            })
      )
    );
    renderIndex();
    await waitFor(() => expect(nativeActivation.suspend).toHaveBeenCalled());
    nativeActivation.context = null;
  });
  it('resolves the logical id before mounting its active Core continuation', async () => {
    enableVersions();
    let resolve!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn((input) =>
        String(input).includes('/source-versions?')
          ? Promise.resolve(Response.json({ configured: false, versions: [], cards: [] }))
          : new Promise<Response>((done) => {
              resolve = done;
            })
      )
    );
    getConversationOrNull.mockResolvedValue({ ...conv('p1'), id: 'continued-core' });
    renderIndex();
    expect(getConversationOrNull).not.toHaveBeenCalled();
    await act(async () =>
      resolve(
        Response.json({
          activeCoreConversationId: 'continued-core',
          activeRevisionId: null,
          headGeneration: 2,
          versions: [],
          reverted: [],
        })
      )
    );
    await waitFor(() => expect(screen.getByTestId('chat')).toHaveTextContent('continued-core'));
    expect(getConversationOrNull).toHaveBeenCalledWith('continued-core');
    expect(getConversationOrNull).not.toHaveBeenCalledWith('c1');
  });
  it('retains the original route behavior when the capability is absent', async () => {
    enableVersions();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    getConversationOrNull.mockResolvedValue(conv('p1'));
    renderIndex();
    await waitFor(() => expect(screen.getByTestId('chat')).toHaveTextContent('c1'));
    expect(getConversationOrNull).toHaveBeenCalledWith('c1');
  });
  it('retains a confirmed legacy route when a background versions read temporarily fails', async () => {
    enableVersions();
    let unavailable = false;
    const fetcher = vi.fn(async (input) =>
      String(input).includes('/source-versions?')
        ? Response.json({ configured: false, versions: [], cards: [] })
        : new Response(null, { status: unavailable ? 503 : 404 })
    );
    vi.stubGlobal('fetch', fetcher);
    getConversationOrNull.mockResolvedValue(conv('p1'));
    renderIndex();
    await waitFor(() => expect(screen.getByTestId('chat')).toHaveTextContent('c1'));
    unavailable = true;
    await act(async () => {
      await refreshCached('/api/platform/conversations/c1/versions');
    });
    await waitFor(() =>
      expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/versions'))).toHaveLength(2)
    );
    expect(screen.getByTestId('chat')).toHaveTextContent('c1');
    expect(screen.getByRole('alert')).toHaveTextContent('conversation.versions.restoreHistoryUnavailable');
  });

  it('still blocks a confirmed legacy route when versions subsequently deny access', async () => {
    enableVersions();
    let denied = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input) =>
        String(input).includes('/source-versions?')
          ? Response.json({ configured: false, versions: [], cards: [] })
          : new Response(null, { status: denied ? 403 : 404 })
      )
    );
    getConversationOrNull.mockResolvedValue(conv('p1'));
    renderIndex();
    await waitFor(() => expect(screen.getByTestId('chat')).toHaveTextContent('c1'));
    denied = true;
    await act(async () => {
      await refreshCached('/api/platform/conversations/c1/versions');
    });
    expect(screen.queryByTestId('chat')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('conversation.versions.unavailable');
  });

  it('does not resume the original Core conversation when resolution fails', async () => {
    enableVersions();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    renderIndex();
    await screen.findByRole('alert');
    expect(getConversationOrNull).not.toHaveBeenCalled();
    expect(screen.queryByTestId('chat')).not.toBeInTheDocument();
  });
  it('keeps the continuation write fence even when independent saved source history succeeds', async () => {
    enableVersions();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) =>
        String(input).includes('/source-versions?')
          ? Response.json({ configured: true, versions: [], cards: [] })
          : new Response(null, { status: 503 })
      );
    vi.stubGlobal('fetch', fetcher);
    renderIndex();
    await screen.findByRole('alert');
    expect(
      fetcher.mock.calls.some(([input]) => String(input) === '/api/platform/source-versions?conversationId=c1')
    ).toBe(true);
    expect(getConversationOrNull).not.toHaveBeenCalled();
    expect(screen.queryByTestId('chat')).not.toBeInTheDocument();
  });
});

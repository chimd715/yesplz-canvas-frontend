import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';
import type { IConversationTurnCompletedEvent } from '@/common/adapter/ipcBridge';

const openPreview = vi.hoisted(() => vi.fn());
const closePreview = vi.hoisted(() => vi.fn());
const turnListeners = vi.hoisted(() => new Set<(event: IConversationTurnCompletedEvent) => void>());
const turnCompleted = vi.hoisted(() =>
  vi.fn((listener: (event: IConversationTurnCompletedEvent) => void) => {
    turnListeners.add(listener);
    return () => {
      turnListeners.delete(listener);
    };
  })
);
const latestMessages = vi.hoisted(() => vi.fn());
vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: { turnCompleted: { on: turnCompleted } },
    database: { getConversationMessages: { invoke: latestMessages } },
  },
}));
vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({ openPreview, closePreview }),
}));
vi.mock('@/renderer/pages/conversation/platforms/useConnectorContinuation', () => ({
  submitConnectorPrompt: vi.fn(),
}));
vi.mock('@/renderer/components/Markdown', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
const nativeActive = vi.hoisted(() => ({ current: true, epoch: 0 }));
const activationListeners = vi.hoisted(() => new Set<() => void>());
vi.mock('@/common/adapter/httpBridge', () => ({
  getBaseUrl: () => '',
  getBuilderWorkspace: () => null,
  getActiveNativeRuntimeContext: () => null,
  isNativeRuntimeActive: () => nativeActive.current,
  nativeRuntimeActivationEpoch: () => nativeActive.epoch,
  subscribeNativeRuntimeActivation: (listener: () => void) => {
    activationListeners.add(listener);
    return () => activationListeners.delete(listener);
  },
  suspendNativeRuntime: () => {},
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { number?: number }) => (values?.number ? `${key} ${values.number}` : key),
  }),
}));
vi.mock('@arco-design/web-react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@arco-design/web-react')>()),
  Message: { success: vi.fn(), error: vi.fn() },
}));

import {
  useVersionHistoryState,
  VersionHistoryProvider,
} from '@/renderer/pages/conversation/components/ChatLayout/VersionHistory';
import { VersionTimelineItems } from '@/renderer/pages/conversation/components/ChatLayout/VersionHistory/VersionCard';
import {
  restoreVersion,
  versionPreviewUrl,
  type VersionHistory,
  type SavedVersion,
  type SourceHistory,
  type SourceVersion,
} from '@/renderer/pages/conversation/components/ChatLayout/VersionHistory/api';
import PublishButton from '@/renderer/pages/conversation/components/ChatLayout/PublishButton';
import {
  localSendStarted,
  resetConversationRuntimeViewStoreForTest,
} from '@/renderer/pages/conversation/runtime/conversationRuntimeViewStore';

const saved = (id: string, sourceConversationId = 'core-1'): SavedVersion => ({
  id,
  sourceConversationId,
  label: `Built ${id}`,
  messageId: `message-${id}`,
  parentRevisionId: null,
  status: 'ready',
  createdAt: 1780000000000,
  previewUrl: `https://${id}.preview.example.app/`,
});
const initial = (): VersionHistory => ({
  activeCoreConversationId: 'core-1',
  activeRevisionId: 'second',
  headGeneration: 1,
  versions: [saved('first'), saved('second')],
  reverted: [],
});
const key = (name: string) => `conversation.versions.${name}`;
function Harness({ publish = false, anchor }: { publish?: boolean; anchor?: string }) {
  const history = useVersionHistoryState('logical');
  return (
    <VersionHistoryProvider value={history}>
      <output data-testid='active'>{history.data?.activeCoreConversationId}</output>
      <output data-testid='error'>{history.restoreError}</output>
      <output data-testid='restoring'>{String(history.restoring)}</output>
      {anchor && (
        <div data-testid='completed-message'>
          <VersionTimelineItems messageIds={[anchor]} />
        </div>
      )}
      <VersionTimelineItems visibleMessageIds={anchor ? [anchor] : []} />
      {publish && <PublishButton conversationId={history.data?.activeCoreConversationId ?? 'logical'} isWidget />}
    </VersionHistoryProvider>
  );
}
const view = (publish = false, anchor?: string) =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
      <Harness publish={publish} anchor={anchor} />
    </SWRConfig>
  );
const card = (number: number) => within(screen.getByRole('region', { name: `${key('version')} ${number}` }));
beforeEach(() => {
  nativeActive.current = true;
  nativeActive.epoch = 0;
  activationListeners.clear();
  resetConversationRuntimeViewStoreForTest();
  vi.stubGlobal('electronAPI', undefined);
  const meta = document.createElement('meta');
  meta.name = 'ai-builder-preview';
  meta.content = 'enabled';
  document.head.append(meta);
  openPreview.mockClear();
  closePreview.mockClear();
  turnCompleted.mockClear();
  latestMessages.mockReset();
  turnListeners.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.querySelector('meta[name="ai-builder-preview"]')?.remove();
  vi.unstubAllGlobals();
});

describe('saved conversation versions', () => {
  it('keeps the active context until restore commits and retains a future for preview and another restore', async () => {
    let current = initial();
    let finish!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      if (init?.method === 'POST')
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      if (String(input).includes('/reverted/'))
        return Response.json({
          items: [
            { id: 'message-second', type: 'text', content: { content: 'The retained future' }, created_at: 2 },
            { id: 'internal', type: 'text', content: 'Do not display hidden context', hidden: true, created_at: 3 },
          ],
        });
      return Response.json(current);
    });
    vi.stubGlobal('fetch', fetcher);
    view();
    await screen.findByText('Built first');
    fireEvent.click(card(1).getByRole('button', { name: key('details') }));
    fireEvent.click(card(1).getByRole('button', { name: key('revert') }));
    expect(screen.getByTestId('active')).toHaveTextContent('core-1');
    expect(screen.getByTestId('restoring')).toHaveTextContent('true');
    await waitFor(() =>
      expect(fetcher.mock.calls.some(([, init]) => init?.body === '{"expectedGeneration":1}')).toBe(true)
    );
    current = {
      ...initial(),
      activeCoreConversationId: 'core-2',
      activeRevisionId: 'first',
      headGeneration: 2,
      versions: [{ ...saved('first'), activeMessageId: 'copied-first' }, saved('second')],
      reverted: [
        { id: 'future', sourceConversationId: 'core-1', afterMessageId: 'message-first', revisionIds: ['second'] },
      ],
    };
    finish(Response.json(current));
    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('core-2'));
    expect(openPreview).toHaveBeenCalledWith(
      'https://first.preview.example.app/',
      'url',
      expect.objectContaining({ editable: false })
    );
    expect(screen.queryByText('The retained future')).not.toBeInTheDocument();
    expect(fetcher.mock.calls.some(([input]) => String(input).includes('/reverted/'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: key('show') }));
    await screen.findByText('The retained future');
    expect(screen.queryByText('Do not display hidden context')).not.toBeInTheDocument();
    fireEvent.click(card(2).getByRole('button', { name: 'preview.preview' }));
    expect(openPreview).toHaveBeenCalledWith(
      'https://second.preview.example.app/',
      'url',
      expect.objectContaining({ editable: false })
    );
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    fireEvent.click(card(2).getByRole('button', { name: key('details') }));
    fireEvent.click(card(2).getByRole('button', { name: key('revert') }));
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(
          ([input, init]) => String(input).endsWith('/second/restore') && init?.body === '{"expectedGeneration":2}'
        )
      ).toBe(true)
    );
    finish(
      Response.json({ ...current, activeCoreConversationId: 'core-3', activeRevisionId: 'second', headGeneration: 3 })
    );
    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('core-3'));
  });

  it('keeps the current context and reports a stale restore without inventing success', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockImplementation(async (_input, init) =>
          init?.method === 'POST' ? new Response(null, { status: 409 }) : Response.json(initial())
        )
    );
    view();
    await screen.findByText('Built first');
    fireEvent.click(card(1).getByRole('button', { name: key('details') }));
    fireEvent.click(card(1).getByRole('button', { name: key('revert') }));
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('conflict'));
    expect(screen.getByTestId('active')).toHaveTextContent('core-1');
    expect(screen.getByTestId('restoring')).toHaveTextContent('false');
  });

  it('does not substitute the live app for an unavailable historical preview', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          ...initial(),
          versions: [{ ...saved('first'), previewUrl: 'http://localhost:3000/' }, saved('second')],
        })
      )
    );
    view();
    await screen.findByText('Built first');
    expect(card(1).getByRole('button', { name: 'preview.preview' })).toBeDisabled();
    expect(openPreview).not.toHaveBeenCalled();
  });

  it('reads publishing status without a partial revision selector before the first saved version', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) =>
      String(input).includes('/versions')
        ? Response.json({
            ...initial(),
            activeCoreConversationId: 'core-2',
            activeRevisionId: null,
            versions: [],
          })
        : Response.json({
            projectId: 'project',
            conversationId: 'core-2',
            phase: 'ready',
            connected: true,
            workspaceMatches: true,
            history: [],
          })
    );
    vi.stubGlobal('fetch', fetcher);
    view(true);
    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('core-2'));
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.publishing.publish', exact: true }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'conversation.publishing.publishApp' })).toBeEnabled()
    );
    expect(
      fetcher.mock.calls.some(([input]) => String(input) === '/api/platform/publishing?conversationId=core-2')
    ).toBe(true);
    expect(
      fetcher.mock.calls
        .filter(([input]) => String(input).includes('/publishing'))
        .every(([input]) => !String(input).includes('logicalConversationId') && !String(input).includes('revisionId'))
    ).toBe(true);
  });

  it.each([true, false])('publishes the selected revision with runtime connected=%s', async (connected) => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) =>
      String(input).includes('/versions')
        ? Response.json(initial())
        : Response.json({
            projectId: 'project',
            conversationId: 'core-1',
            phase: 'ready',
            connected,
            savedRevisionAvailable: !connected,
            workspaceMatches: true,
            history: [
              {
                conversationId: 'core-1',
                revisionId: 'second',
                url: 'https://public.example.app/',
                embedCode: '<script src="https://public.example.app/widget.js"></script>',
              },
            ],
          })
    );
    vi.stubGlobal('fetch', fetcher);
    view(true);
    await screen.findByText('Built first');
    fireEvent.click(card(1).getByRole('button', { name: 'preview.preview' }));
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.publishing.publish', exact: true }));
    const button = await screen.findByRole('button', { name: 'conversation.publishing.publishApp' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(
          ([input, init]) =>
            String(input) === '/api/platform/publishing/publish' &&
            init?.body === '{"conversationId":"core-1","logicalConversationId":"logical","revisionId":"first"}'
        )
      ).toBe(true)
    );
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'conversation.embedding.embed', exact: true }));
    expect(await screen.findByText('conversation.embedding.replaced')).toBeVisible();
    expect(screen.queryByLabelText('conversation.embedding.installationCode')).not.toBeInTheDocument();
    expect(
      fetcher.mock.calls.some(([input]) => String(input).includes('logicalConversationId=logical&revisionId=first'))
    ).toBe(true);
  });
});

describe('version response validation', () => {
  it('accepts only the matching revision at the trusted same-origin preview handoff', () => {
    const id = '22222222-2222-4222-8222-222222222222';
    const path = `/platform/projects/11111111-1111-4111-8111-111111111111/revisions/logical/${id}/preview?embed=1`;
    expect(versionPreviewUrl({ ...saved(id), previewUrl: path })).toBe(window.location.origin + path);
    expect(versionPreviewUrl({ ...saved(id), previewUrl: window.location.origin + path })).toBe(
      window.location.origin + path
    );
    expect(versionPreviewUrl({ ...saved('another'), previewUrl: path })).toBeUndefined();
    expect(versionPreviewUrl({ ...saved(id), previewUrl: path + '&redirect=/live' })).toBeUndefined();
  });

  it('rejects a restore response that did not commit the requested generation and revision', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(initial())));
    await expect(restoreVersion('logical', 'first', 1, new AbortController().signal)).rejects.toMatchObject({
      status: 502,
    });
  });
  it.each([
    'javascript:alert(1)',
    'http://localhost:3000/',
    'https://user:secret@preview.example.app/',
    window.location.origin + '/live',
  ])('rejects unsafe or live preview %s', (previewUrl) => {
    expect(versionPreviewUrl({ ...saved('first'), previewUrl })).toBeUndefined();
  });
});

const sourceApp = '11111111-1111-4111-8111-111111111111';
const sourceA = '22222222-2222-4222-8222-222222222222';
const sourceB = '33333333-3333-4333-8333-333333333333';
const source = (id = sourceA, sourceKind: 'static' | 'node' = 'static'): SourceVersion => ({
  id,
  appId: '44444444-4444-4444-8444-444444444444',
  createdAt: '2026-09-29T00:00:00.000Z',
  sourceKind,
  sourceRevision: 'a'.repeat(64),
  conversationId: 'logical',
  previewUrl: `/platform/projects/${sourceApp}/source-versions/${id}/preview?embed=1`,
});
const sourceHistory = (): SourceHistory => ({
  configured: true,
  versions: [source()],
  cards: [{ messageId: 'older-message', sourceVersionId: sourceA }],
  latestSavedVersionId: sourceA,
});
const sourceCard = (number: number) =>
  within(screen.getByRole('region', { name: `${key('sourceVersion')} ${number}` }));
const publishing = (overrides: Record<string, unknown> = {}) =>
  Response.json({
    projectId: 'project',
    conversationId: 'logical',
    phase: 'ready',
    connected: true,
    workspaceMatches: true,
    history: [],
    ...overrides,
  });
const completed = (overrides: Partial<IConversationTurnCompletedEvent> = {}): IConversationTurnCompletedEvent => ({
  session_id: 'logical',
  turn_id: 'turn-b',
  status: 'finished',
  state: 'ai_waiting_input',
  detail: '',
  can_send_message: true,
  runtime: {
    state: 'idle',
    can_send_message: true,
    has_task: false,
    is_processing: false,
    pending_confirmations: 0,
    turn_id: 'turn-b',
    supports_midturn_delivery: false,
  },
  workspace: '/widget',
  model: { platform: '', name: '', use_model: '' },
  last_message: { id: 'done-b', type: 'text', content: 'Completed widget', created_at: 1780000000000 },
  ...overrides,
});
const emitCompleted = (event = completed()) =>
  act(async () => {
    turnListeners.forEach((listener) => listener(event));
  });

describe('saved widget source versions', () => {
  const mirroredCompletion = (id = 'done-b') => ({
    items: [{ id, conversation_id: 'logical', type: 'text', position: 'left', status: 'finish', hidden: false }],
  });
  const autoSaveFixture = (snapshot: () => Response) => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/platform/source-versions/snapshot') return snapshot();
      if (url.includes('/source-versions?')) return Response.json({ configured: true, versions: [], cards: [] });
      if (url.includes('/conversations/')) return new Response(null, { status: 404 });
      return publishing();
    });
    vi.stubGlobal('fetch', fetcher);
    return fetcher;
  };
  const capturedCompletion = () =>
    Response.json({
      ...sourceHistory(),
      versionId: sourceA,
      messageId: 'done-b',
      cards: [{ messageId: 'done-b', sourceVersionId: sourceA }],
    });

  it('waits briefly for the completed message to reach the central mirror before saving its card', async () => {
    latestMessages.mockResolvedValueOnce({ items: [] }).mockResolvedValue(mirroredCompletion());
    const fetcher = autoSaveFixture(capturedCompletion);
    view(true, 'done-b');
    await screen.findByRole('button', { name: 'conversation.publishing.publish', exact: true });
    vi.useFakeTimers();
    await emitCompleted(completed({ last_message: { content: null, created_at: 1780000000000 } }));
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(latestMessages).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(within(screen.getByTestId('completed-message')).getByRole('region')).toBeVisible();
  });

  it('refreshes an inferred stale message after a confirmed mismatch and reconciles before retrying', async () => {
    latestMessages.mockResolvedValueOnce(mirroredCompletion('previous')).mockResolvedValue(mirroredCompletion());
    let attempts = 0;
    const fetcher = autoSaveFixture(() =>
      ++attempts === 1 ? Response.json({ code: 'source_message_mismatch' }, { status: 409 }) : capturedCompletion()
    );
    view(true, 'done-b');
    await screen.findByRole('button', { name: 'conversation.publishing.publish', exact: true });
    vi.useFakeTimers();
    await emitCompleted(completed({ last_message: { content: null, created_at: 1780000000000 } }));
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    const calls = fetcher.mock.calls;
    const posts = calls.map(([, init], index) => (init?.method === 'POST' ? index : -1)).filter((index) => index >= 0);
    expect(posts.map((index) => calls[index][1]?.body)).toEqual([
      '{"conversationId":"logical","messageId":"previous"}',
      '{"conversationId":"logical","messageId":"done-b"}',
    ]);
    expect(calls.slice(posts[0] + 1, posts[1]).some(([input]) => String(input).includes('/source-versions?'))).toBe(
      true
    );
  });

  it('keeps an explicit completion ID pinned while retrying a known busy snapshot', async () => {
    let attempts = 0;
    const fetcher = autoSaveFixture(() =>
      ++attempts === 1 ? Response.json({ code: 'source_busy' }, { status: 409 }) : capturedCompletion()
    );
    view(true, 'done-b');
    await screen.findByRole('button', { name: 'conversation.publishing.publish', exact: true });
    vi.useFakeTimers();
    await emitCompleted();
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(latestMessages).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => init?.body)).toEqual([
      '{"conversationId":"logical","messageId":"done-b"}',
      '{"conversationId":"logical","messageId":"done-b"}',
    ]);
  });

  it('stops after three mirror-read retries without posting an unanchored snapshot', async () => {
    latestMessages.mockResolvedValue({ items: [] });
    const fetcher = autoSaveFixture(capturedCompletion);
    view(true);
    await screen.findByRole('button', { name: 'conversation.publishing.publish', exact: true });
    vi.useFakeTimers();
    await emitCompleted(completed({ last_message: { content: null, created_at: 1780000000000 } }));
    await act(async () => vi.advanceTimersByTimeAsync(10000));
    expect(latestMessages).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    expect(screen.getByText(key('snapshot.busy'))).toBeVisible();
  });

  it.each(['new turn', 'activation changed', 'unmounted'])('cancels an automatic retry when %s', async (reason) => {
    latestMessages.mockResolvedValueOnce({ items: [] }).mockResolvedValue(mirroredCompletion());
    const fetcher = autoSaveFixture(capturedCompletion);
    const rendered = view(true);
    await screen.findByRole('button', { name: 'conversation.publishing.publish', exact: true });
    vi.useFakeTimers();
    await emitCompleted(completed({ last_message: { content: null, created_at: 1780000000000 } }));
    await act(async () => {
      if (reason === 'new turn') localSendStarted('logical');
      else if (reason === 'unmounted') rendered.unmount();
      else {
        nativeActive.epoch += 1;
        activationListeners.forEach((listener) => listener());
      }
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(latestMessages).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    expect(screen.queryByText(key('snapshot.busy'))).not.toBeInTheDocument();
  });

  it('reconciles a lost snapshot response without retrying the POST', async () => {
    let captured = false;
    const current = { ...sourceHistory(), cards: [{ messageId: 'done-b', sourceVersionId: sourceA }] };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      if (init?.method === 'POST') {
        captured = true;
        throw new TypeError('Response was lost');
      }
      if (String(input).includes('/source-versions?'))
        return Response.json(captured ? current : { configured: true, versions: [], cards: [] });
      if (String(input).includes('/conversations/')) return new Response(null, { status: 404 });
      return publishing();
    });
    vi.stubGlobal('fetch', fetcher);
    view(true, 'done-b');
    await screen.findByRole('button', { name: 'conversation.publishing.publish', exact: true });
    vi.useFakeTimers();
    await emitCompleted();
    await act(async () => vi.advanceTimersByTimeAsync(10000));
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(within(screen.getByTestId('completed-message')).getByRole('region')).toBeVisible();
  });

  it('resolves the latest persisted completion when Core omits last_message and displays its saved Preview card', async () => {
    latestMessages.mockResolvedValue({
      items: [
        {
          id: 'done-b',
          conversation_id: 'logical',
          type: 'text',
          position: 'left',
          status: 'finish',
          hidden: false,
          created_at: 1780000000000,
        },
      ],
    });
    const current = { ...sourceHistory(), cards: [{ messageId: 'done-b', sourceVersionId: sourceA }] };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/platform/source-versions/snapshot')
        return Response.json({ ...current, versionId: sourceA, messageId: 'done-b' });
      if (url.includes('/source-versions?')) return Response.json({ configured: true, versions: [], cards: [] });
      if (url.includes('/conversations/')) return new Response(null, { status: 404 });
      return publishing();
    });
    vi.stubGlobal('fetch', fetcher);
    view(true, 'done-b');
    await screen.findByRole('button', { name: 'conversation.publishing.publish', exact: true });
    const nativeEvent = completed({ last_message: { content: null, created_at: 1780000000000 } });
    await emitCompleted(nativeEvent);
    expect(
      await within(screen.getByTestId('completed-message')).findByRole('region', {
        name: `${key('sourceVersion')} 1`,
      })
    ).toBeVisible();
    await emitCompleted(nativeEvent);
    expect(latestMessages).toHaveBeenCalledWith({ conversation_id: 'logical', limit: 1 });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => init?.body)).toEqual([
      '{"conversationId":"logical","messageId":"done-b"}',
    ]);
  });

  it.each([{ position: 'right' }, { status: 'work' }, { hidden: true }, { conversation_id: 'other' }])(
    'does not attach current files to an invalid completion (%j)',
    async (overrides) => {
      latestMessages.mockResolvedValue({
        items: [
          {
            id: 'done-b',
            conversation_id: 'logical',
            type: 'text',
            position: 'left',
            status: 'finish',
            hidden: false,
            ...overrides,
          },
        ],
      });
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/source-versions?')) return Response.json({ configured: true, versions: [], cards: [] });
        if (url.includes('/conversations/')) return new Response(null, { status: 404 });
        return publishing();
      });
      vi.stubGlobal('fetch', fetcher);
      view(true);
      await screen.findByRole('button', { name: 'conversation.publishing.publish', exact: true });
      vi.useFakeTimers();
      await emitCompleted(completed({ last_message: { content: null, created_at: 1780000000000 } }));
      await act(async () => vi.advanceTimersByTimeAsync(3000));
      expect(screen.getByText(key('snapshot.busy'))).toBeVisible();
      expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    }
  );

  it('allows a repeated completion to retry after capture fails, without a polling loop', async () => {
    let failed = true;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/platform/source-versions/snapshot')
        return failed
          ? new Response(null, { status: 409 })
          : Response.json({
              ...sourceHistory(),
              versionId: sourceA,
              messageId: 'done-b',
              cards: [{ messageId: 'done-b', sourceVersionId: sourceA }],
            });
      if (url.includes('/source-versions?')) return Response.json({ configured: true, versions: [], cards: [] });
      if (url.includes('/conversations/')) return new Response(null, { status: 404 });
      return publishing();
    });
    vi.stubGlobal('fetch', fetcher);
    view(true, 'done-b');
    await screen.findByRole('button', { name: 'conversation.publishing.publish', exact: true });
    await emitCompleted();
    await screen.findByText(key('snapshot.busy'));
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    failed = false;
    await emitCompleted();
    expect(
      await within(screen.getByTestId('completed-message')).findByRole('region', {
        name: `${key('sourceVersion')} 1`,
      })
    ).toBeVisible();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2);
  });

  it('captures one new idle completion, renders its persisted card beside the message, and reloads without backfill', async () => {
    let current = sourceHistory();
    let finish!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/platform/source-versions/snapshot')
        return new Promise((resolve) => {
          finish = resolve;
        });
      if (url.includes('/source-versions?')) return Response.json(current);
      if (url.includes('/conversations/')) return new Response(null, { status: 404 });
      return publishing();
    });
    vi.stubGlobal('fetch', fetcher);
    const first = view(true, 'done-b');
    await screen.findByRole('region', { name: `${key('sourceVersion')} 1` });
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    await emitCompleted(completed({ status: 'running' }));
    await emitCompleted(completed({ runtime: { ...completed().runtime, is_processing: true } }));
    await emitCompleted(completed({ session_id: 'other' }));
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    await emitCompleted();
    await emitCompleted();
    await waitFor(() => expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1));
    expect(fetcher.mock.calls.find(([, init]) => init?.method === 'POST')?.[1]?.body).toBe(
      '{"conversationId":"logical","messageId":"done-b"}'
    );
    expect(screen.queryByRole('region', { name: `${key('sourceVersion')} 2` })).not.toBeInTheDocument();
    current = {
      ...current,
      versions: [...current.versions, source(sourceB)],
      cards: [...current.cards, { messageId: 'done-b', sourceVersionId: sourceB }],
      latestSavedVersionId: sourceB,
    };
    await act(async () => finish(Response.json({ ...current, versionId: sourceB, messageId: 'done-b' })));
    expect(
      await within(screen.getByTestId('completed-message')).findByRole('region', { name: `${key('sourceVersion')} 2` })
    ).toBeVisible();
    first.unmount();
    view(true, 'done-b');
    await within(screen.getByTestId('completed-message')).findByRole('region', { name: `${key('sourceVersion')} 2` });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('previews and publishes the same saved source without native restore or a live runtime', async () => {
    nativeActive.current = false;
    let published = false;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/source-versions?'))
        return Response.json({ ...sourceHistory(), ...(published ? { publishedSourceVersionId: sourceA } : {}) });
      if (url.includes('/conversations/')) return new Response(null, { status: 404 });
      if (init?.method === 'POST') published = true;
      return publishing({
        connected: false,
        savedSourceAvailable: url.includes(`sourceVersionId=${sourceA}`) || published,
        history: published
          ? [{ conversationId: 'logical', sourceVersionId: sourceA, url: 'https://public.example.app/' }]
          : [],
      });
    });
    vi.stubGlobal('fetch', fetcher);
    view(true);
    await screen.findByRole('region', { name: `${key('sourceVersion')} 1` });
    expect(fetcher.mock.calls.some(([input]) => String(input).startsWith('/api/platform/publishing?'))).toBe(false);
    fireEvent.click(sourceCard(1).getByRole('button', { name: 'preview.preview' }));
    expect(openPreview).toHaveBeenCalledWith(
      window.location.origin + source().previewUrl,
      'url',
      expect.objectContaining({ editable: false })
    );
    fireEvent.click(sourceCard(1).getByRole('button', { name: key('details') }));
    expect(sourceCard(1).queryByRole('button', { name: key('revert') })).not.toBeInTheDocument();
    expect(sourceCard(1).getByText(key('selected'))).toBeVisible();
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.publishing.publish', exact: true }));
    const button = await screen.findByRole('button', { name: 'conversation.publishing.publishApp' });
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.getByRole('link', { name: 'preview.preview' })).toHaveAttribute(
      'href',
      window.location.origin + source().previewUrl
    );
    fireEvent.click(button);
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(
          ([input, init]) =>
            String(input) === '/api/platform/publishing/publish' &&
            init?.body === `{"conversationId":"logical","sourceVersionId":"${sourceA}"}`
        )
      ).toBe(true)
    );
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(fetcher.mock.calls.some(([input]) => String(input).includes('/restore'))).toBe(false);
    expect(
      fetcher.mock.calls
        .filter(([input]) => String(input).includes('/publishing'))
        .every(([input]) => !String(input).includes('revisionId=') && !String(input).includes('logicalConversationId='))
    ).toBe(true);
    await waitFor(() => expect(sourceCard(1).getByText(key('published'))).toBeVisible());
  });

  it('shows a busy capture failure and retries only current work without creating an old-turn card', async () => {
    let current: SourceHistory = { configured: true, versions: [], cards: [] };
    let attempts = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/platform/source-versions/snapshot') {
        if (++attempts === 1) return new Response(null, { status: 409 });
        current = { configured: true, versions: [source()], cards: [], latestSavedVersionId: sourceA };
        return Response.json({ ...current, versionId: sourceA });
      }
      if (url.includes('/source-versions?')) return Response.json(current);
      if (url.includes('/conversations/')) return new Response(null, { status: 404 });
      return publishing();
    });
    vi.stubGlobal('fetch', fetcher);
    view(true);
    await waitFor(() => expect(turnListeners.size).toBe(1));
    await emitCompleted();
    await screen.findByText(key('snapshot.busy'));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.publishing.publish', exact: true }));
    const retry = await screen.findByRole('button', { name: key('saveCurrent') });
    await waitFor(() => expect(retry).toBeEnabled());
    fireEvent.click(retry);
    await screen.findByRole('region', { name: `${key('sourceVersion')} 1` });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => init?.body)).toEqual([
      '{"conversationId":"logical","messageId":"done-b"}',
      '{"conversationId":"logical"}',
    ]);
  });

  it('keeps current live preview available and names the saved Node preview limitation', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/source-versions?'))
        return Response.json({ ...sourceHistory(), versions: [source(sourceA, 'node')] });
      if (url.includes('/conversations/')) return new Response(null, { status: 404 });
      return publishing();
    });
    vi.stubGlobal('fetch', fetcher);
    view(true);
    await screen.findByRole('region', { name: `${key('sourceVersion')} 1` });
    expect(sourceCard(1).getByRole('button', { name: 'preview.preview' })).toBeDisabled();
    expect(sourceCard(1).getByText(key('dynamicPreviewUnavailable'))).toBeVisible();
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.publishing.publish', exact: true }));
    const panel = within(await screen.findByRole('tooltip'));
    const currentPreview = panel.getByRole('button', { name: 'preview.preview' });
    expect(currentPreview.closest('form')).toHaveAttribute('action', '/api/platform/preview');
    expect(currentPreview).toBeEnabled();
    fireEvent.click(sourceCard(1).getByRole('button', { name: key('details') }));
    fireEvent.click(sourceCard(1).getByRole('button', { name: key('select') }));
    await waitFor(() =>
      expect(within(screen.getByRole('tooltip')).getByRole('button', { name: 'preview.preview' })).toBeDisabled()
    );
    expect(openPreview).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('closes the previous Preview when a different saved source is selected for Publish', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/source-versions?'))
          return Response.json({ ...sourceHistory(), versions: [source(), source(sourceB)] });
        if (url.includes('/conversations/')) return new Response(null, { status: 404 });
        return publishing();
      })
    );
    view(true);
    await screen.findByRole('region', { name: `${key('sourceVersion')} 2` });
    fireEvent.click(sourceCard(1).getByRole('button', { name: 'preview.preview' }));
    closePreview.mockClear();
    fireEvent.click(sourceCard(2).getByRole('button', { name: key('details') }));
    fireEvent.click(sourceCard(2).getByRole('button', { name: key('select') }));
    expect(closePreview).toHaveBeenCalledOnce();
    expect(sourceCard(2).getByText(key('selected'))).toBeVisible();
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.publishing.publish', exact: true }));
    expect(await screen.findByRole('link', { name: 'preview.preview' })).toHaveAttribute(
      'href',
      window.location.origin + source(sourceB).previewUrl
    );
    expect(openPreview).toHaveBeenCalledOnce();
  });

  it('states unavailable version saving and never captures when it is not configured', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/source-versions?')) return Response.json({ configured: false, versions: [], cards: [] });
      if (url.includes('/conversations/')) return new Response(null, { status: 404 });
      return publishing();
    });
    vi.stubGlobal('fetch', fetcher);
    view(true);
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.publishing.publish', exact: true }));
    await screen.findByText(key('snapshot.notConfigured'));
    expect(screen.getByRole('button', { name: key('saveCurrent') })).toBeDisabled();
    await emitCompleted();
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('keeps source cards and explicit saved Preview available while unresolved native history blocks current-work capture', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/source-versions/snapshot')) return Response.json({ ...sourceHistory(), versionId: sourceA });
      if (url.includes('/source-versions?')) return Response.json(sourceHistory());
      if (url.includes('/conversations/')) return new Response(null, { status: 503 });
      return publishing();
    });
    vi.stubGlobal('fetch', fetcher);
    view(true);
    await screen.findByRole('region', { name: `${key('sourceVersion')} 1` });
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.publishing.publish', exact: true }));
    expect(screen.getByRole('combobox')).toHaveTextContent(key('currentWork'));
    const save = screen.getByRole('button', { name: key('saveCurrent') });
    await waitFor(() => expect(save).toBeDisabled());
    fireEvent.click(save);
    await emitCompleted();
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    fireEvent.click(sourceCard(1).getByRole('button', { name: 'preview.preview' }));
    expect(openPreview).toHaveBeenCalledWith(
      window.location.origin + source().previewUrl,
      'url',
      expect.objectContaining({ editable: false })
    );
    expect(sourceCard(1).getByText(key('selected'))).toBeVisible();
    expect(fetcher.mock.calls.some(([input]) => String(input).includes('/restore'))).toBe(false);
  });

  it('accepts the matching source-version handoff under its workspace project, distinct from the widget app identity', () => {
    const version = source();
    expect(versionPreviewUrl(version)).toBe(window.location.origin + version.previewUrl);
    expect(version.appId).not.toBe(sourceApp);
    for (const previewUrl of [
      version.previewUrl.replace(sourceA, sourceB),
      version.previewUrl + '&redirect=/live',
      window.location.origin + '/live',
      `https://foreign.example${version.previewUrl}`,
      `https://isolated.example/`,
      `/platform/projects/${sourceApp}/revisions/logical/${sourceA}/preview?embed=1`,
    ])
      expect(versionPreviewUrl({ ...version, previewUrl })).toBeUndefined();
    expect(versionPreviewUrl({ ...version, sourceKind: 'node' })).toBeUndefined();
  });
});

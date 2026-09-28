import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';

const openPreview = vi.hoisted(() => vi.fn());
const turnCompleted = vi.hoisted(() => vi.fn(() => () => undefined));
vi.mock('@/common', () => ({ ipcBridge: { conversation: { turnCompleted: { on: turnCompleted } } } }));
vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({ openPreview, closePreview: vi.fn() }),
}));
vi.mock('@/renderer/components/Markdown', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/common/adapter/httpBridge', () => ({ getBaseUrl: () => '' }));
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
} from '@/renderer/pages/conversation/components/ChatLayout/VersionHistory/api';
import PublishButton from '@/renderer/pages/conversation/components/ChatLayout/PublishButton';

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
function Harness({ publish = false }: { publish?: boolean }) {
  const history = useVersionHistoryState('logical');
  return (
    <VersionHistoryProvider value={history}>
      <output data-testid='active'>{history.data?.activeCoreConversationId}</output>
      <output data-testid='error'>{history.restoreError}</output>
      <output data-testid='restoring'>{String(history.restoring)}</output>
      <VersionTimelineItems />
      {publish && <PublishButton conversationId={history.data?.activeCoreConversationId ?? 'core-1'} isWidget />}
    </VersionHistoryProvider>
  );
}
const view = (publish = false) =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
      <Harness publish={publish} />
    </SWRConfig>
  );
const card = (number: number) => within(screen.getByRole('region', { name: `${key('version')} ${number}` }));
beforeEach(() => {
  vi.stubGlobal('electronAPI', undefined);
  const meta = document.createElement('meta');
  meta.name = 'ai-builder-preview';
  meta.content = 'enabled';
  document.head.append(meta);
  openPreview.mockClear();
  turnCompleted.mockClear();
});
afterEach(() => {
  cleanup();
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
    expect(await screen.findByRole('button', { name: 'conversation.publishing.publishApp' })).toBeDisabled();
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

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';

const platform = vi.hoisted(() => ({ desktop: false }));
const copy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => platform.desktop }));
vi.mock('@/renderer/utils/ui/clipboard', () => ({ copyText: copy }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
// Toasts use the application's React 19 bridge, outside this component's rendering scope.
vi.mock('@arco-design/web-react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@arco-design/web-react')>()),
  Message: { success: vi.fn(), error: vi.fn() },
}));

import PublishButton from '@/renderer/pages/conversation/components/ChatLayout/PublishButton';

const key = (name: string) => `conversation.publishing.${name}`;
const status = (overrides: Record<string, unknown> = {}, code = 200) =>
  Response.json(
    {
      projectId: 'project',
      conversationId: 'first',
      phase: 'ready',
      connected: true,
      workspaceMatches: true,
      history: [],
      ...overrides,
    },
    { status: code }
  );

function view(conversationId = 'first') {
  const cache = new Map();
  const content = (id: string) => (
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0, revalidateOnFocus: false }}>
      <PublishButton key={id} conversationId={id} />
    </SWRConfig>
  );
  const result = render(content(conversationId));
  return { ...result, navigate: (id: string) => result.rerender(content(id)) };
}

async function open() {
  fireEvent.click(await screen.findByRole('button', { name: key('publish'), exact: true }));
  await screen.findByText(key('title'));
}

beforeEach(() => {
  platform.desktop = false;
  copy.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('conversation publishing', () => {
  it('adds no control or request to Electron, and no control to a plain Aion host', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetcher);
    platform.desktop = true;
    const desktop = view();
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    desktop.unmount();

    platform.desktop = false;
    view();
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('explains a missing deployable app and never publishes from status or popover navigation', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => status({ workspaceMatches: false }));
    vi.stubGlobal('fetch', fetcher);
    view();
    await open();
    expect(await screen.findByText(key('noApp'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: key('publishApp') })).toBeDisabled();
    expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
  });

  it('publishes once on explicit action, polls pending work, and shares only a safe current-conversation URL', async () => {
    let started = false;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      if (init?.method === 'POST') {
        started = true;
        return status({ phase: 'publishing' }, 202);
      }
      return status({
        history: started
          ? [{ url: 'https://current.example.app/', conversationId: 'first' }]
          : [
              { url: 'https://other.example.app/', conversationId: 'other' },
              { url: 'javascript:alert(1)', conversationId: 'first' },
            ],
      });
    });
    vi.stubGlobal('fetch', fetcher);
    view();
    await open();
    const publish = screen.getByRole('button', { name: key('publishApp') });
    await waitFor(() => expect(publish).toBeEnabled());
    expect(screen.queryByLabelText(key('publicUrl'))).not.toBeInTheDocument();
    expect(started).toBe(false);
    fireEvent.click(publish);
    fireEvent.click(publish);
    await waitFor(() => expect(screen.getByRole('button', { name: key('inProgress') })).toBeDisabled());
    const posted = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posted).toHaveLength(1);
    expect(posted[0]).toEqual([
      '/api/platform/publishing/publish',
      expect.objectContaining({ credentials: 'same-origin', body: JSON.stringify({ conversationId: 'first' }) }),
    ]);
    const link = await screen.findByRole('link', { name: key('openApp') }, { timeout: 5000 });
    expect(link).toHaveAttribute('href', 'https://current.example.app/');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    fireEvent.click(screen.getByRole('button', { name: key('copyLink') }));
    expect(copy).toHaveBeenCalledWith('https://current.example.app/');
  });

  it('aborts a pending submission on conversation change and ignores its late result and unrelated legacy history', async () => {
    let resolvePost: (response: Response) => void = () => {};
    const post = new Promise<Response>((resolve) => {
      resolvePost = resolve;
    });
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      if (init?.method === 'POST') return post;
      return status({ history: [{ url: 'https://legacy.example.app/' }] });
    });
    vi.stubGlobal('fetch', fetcher);
    const page = view();
    await open();
    await waitFor(() => expect(screen.getByRole('button', { name: key('publishChanges') })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: key('publishChanges') }));
    const submitted = fetcher.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(submitted).toBeDefined();
    page.navigate('second');
    expect(submitted?.[1]?.signal?.aborted).toBe(true);
    await open();
    await act(async () =>
      resolvePost(status({ history: [{ url: 'https://late.example.app/', conversationId: 'first' }] }, 202))
    );
    expect(screen.queryByLabelText(key('publicUrl'))).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('https://late.example.app/')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: key('publishApp') })).toBeEnabled());
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('disables publishing when a status refresh fails and retries only the status request', async () => {
    let unavailable = false;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => (unavailable ? new Response(null, { status: 503 }) : status()));
    vi.stubGlobal('fetch', fetcher);
    view();
    await screen.findByRole('button', { name: key('publish'), exact: true });
    unavailable = true;
    await open();
    expect(await screen.findByText(key('unavailable'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: key('publishApp') })).toBeDisabled();
    unavailable = false;
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }));
    await waitFor(() => expect(screen.getByRole('button', { name: key('publishApp') })).toBeEnabled());
    expect(fetcher.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
  });
});

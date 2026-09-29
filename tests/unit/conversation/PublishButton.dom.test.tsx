import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';

const platform = vi.hoisted(() => ({ desktop: false }));
const copy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/common', () => ({ ipcBridge: { conversation: { turnCompleted: { on: vi.fn() } } } }));
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
const embedKey = (name: string) => `conversation.embedding.${name}`;
const embedCode = '<script src="https://current.example.app/widget.js" defer></script>\n<shop-widget></shop-widget>';
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

function view(conversationId = 'first', isWidget = false) {
  const cache = new Map();
  const content = (id: string) => (
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0, revalidateOnFocus: false }}>
      <PublishButton key={id} conversationId={id} isWidget={isWidget} />
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
  it('opens platform-specific installation help beside Publish and copies the published code without deploying', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) =>
      status({
        history: [
          {
            url: 'https://current.example.app/',
            conversationId: 'first',
            ...(String(input).includes('/embed?') ? { embedCode } : {}),
          },
        ],
      })
    );
    vi.stubGlobal('fetch', fetcher);
    view();
    fireEvent.click(await screen.findByRole('button', { name: embedKey('embed'), exact: true }));
    expect(await screen.findByLabelText(embedKey('installationCode'))).toHaveValue(embedCode);
    expect(screen.getByText(embedKey('shopifyAdd'))).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: embedKey('others') }));
    expect(await screen.findByText(embedKey('htmlPaste'))).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: embedKey('copyCode') }));
    expect(copy).toHaveBeenCalledWith(embedCode);
    expect(
      fetcher.mock.calls.some(([input]) => String(input) === '/api/platform/publishing/embed?conversationId=first')
    ).toBe(true);
    expect(fetcher.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
  });

  it('opens installation code after publishing a widget conversation successfully', async () => {
    let published = false;
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
        if (init?.method === 'POST') published = true;
        return status({
          history: published ? [{ url: 'https://current.example.app/', conversationId: 'first', embedCode }] : [],
        });
      })
    );
    view('first', true);
    await open();
    const publish = screen.getByRole('button', { name: key('publishApp') });
    await waitFor(() => expect(publish).toBeEnabled());
    fireEvent.click(publish);
    expect(await screen.findByLabelText(embedKey('installationCode'))).toHaveValue(embedCode);
  });

  it('copies declared dynamic Liquid inputs and preserves fixed settings and HTML preview examples', async () => {
    const marked = embedCode.replace(
      '<shop-widget>',
      `<shop-widget product-id="123456789" collection-id="987654321" customer-id="42" data-shopify-bindings='{"product-id":"product.id","collection-id":"collection.id","customer-id":"customer.id"}' limit="8" heading="A &amp; B &quot;Sale&quot;">`
    );
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockImplementation(async () =>
          status({ history: [{ url: 'https://current.example.app/', conversationId: 'first', embedCode: marked }] })
        )
    );
    view();
    fireEvent.click(await screen.findByRole('button', { name: embedKey('embed'), exact: true }));
    const input = await screen.findByLabelText(embedKey('installationCode'));
    const shopify =
      '<script src="https://current.example.app/widget.js" defer=""></script>\n<shop-widget product-id="{{ product.id | escape }}" collection-id="{{ collection.id | escape }}" customer-id="{{ customer.id | escape }}" limit="8" heading="A &amp; B &quot;Sale&quot;"></shop-widget>';
    expect(input).toHaveValue(shopify);
    fireEvent.click(screen.getByRole('button', { name: embedKey('copyCode') }));
    expect(copy).toHaveBeenLastCalledWith(shopify);

    fireEvent.click(screen.getByRole('tab', { name: embedKey('others') }));
    const html =
      '<script src="https://current.example.app/widget.js" defer=""></script>\n<shop-widget product-id="123456789" collection-id="987654321" customer-id="42" limit="8" heading="A &amp; B &quot;Sale&quot;"></shop-widget>';
    expect(input).toHaveValue(html);
    fireEvent.click(screen.getByRole('button', { name: embedKey('copyCode') }));
    expect(copy).toHaveBeenLastCalledWith(html);
    fireEvent.click(screen.getByRole('tab', { name: embedKey('shopify') }));
    expect(input).toHaveValue(shopify);
  });

  it('supports dynamic collection and page context without a product ID', async () => {
    const marked = embedCode.replace(
      '<shop-widget>',
      `<shop-widget collection-id="987654321" page-path="/collections/example" data-shopify-bindings='{"collection-id":"collection.id","page-path":"request.path"}'>`
    );
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockImplementation(async () =>
          status({ history: [{ url: 'https://current.example.app/', conversationId: 'first', embedCode: marked }] })
        )
    );
    view();
    fireEvent.click(await screen.findByRole('button', { name: embedKey('embed'), exact: true }));
    expect(await screen.findByLabelText(embedKey('installationCode'))).toHaveValue(
      '<script src="https://current.example.app/widget.js" defer=""></script>\n<shop-widget collection-id="{{ collection.id | escape }}" page-path="{{ request.path | escape }}"></shop-widget>'
    );
  });

  it.each([
    'product-id="123456789"',
    'product-id="123456789" data-product-context="demo"',
    'product-id="123456789" data-other-bindings="product.id"',
    'product-id="123456789" data-shopify-bindings="not JSON"',
    `product-id="123456789" data-shopify-bindings='[]'`,
    `product-id="123456789" data-shopify-bindings='{}'`,
    `product-id="123456789" data-shopify-bindings='{"product-id":42}'`,
    `product-id="123456789" data-shopify-bindings='{"product-id":"product.id }}{{ customer.email"}'`,
    `product-id="123456789" data-shopify-bindings='{"collection-id":"collection.id"}'`,
    `onclick="example" data-shopify-bindings='{"onclick":"product.id"}'`,
    `data-shopify-bindings='{"data-shopify-bindings":"product.id"}'`,
  ])('keeps undeclared, malformed or unsafe dynamic inputs unchanged (%s)', async (attributes) => {
    const original = embedCode.replace('<shop-widget>', `<shop-widget ${attributes}>`);
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockImplementation(async () =>
          status({ history: [{ url: 'https://current.example.app/', conversationId: 'first', embedCode: original }] })
        )
    );
    view();
    fireEvent.click(await screen.findByRole('button', { name: embedKey('embed'), exact: true }));
    expect(await screen.findByLabelText(embedKey('installationCode'))).toHaveValue(original);
  });

  it.each([
    ['publishFirst', {}],
    ['publishAgain', { history: [{ url: 'https://current.example.app/', conversationId: 'first' }] }],
    [
      'replaced',
      {
        history: [
          { url: 'https://current.example.app/', conversationId: 'first', embedCode },
          { url: 'https://current.example.app/', conversationId: 'other', embedCode },
        ],
      },
    ],
    ['publishAgain', { history: [{ url: 'javascript:alert(1)', conversationId: 'first', embedCode }] }],
    [
      'pending',
      { phase: 'publishing', history: [{ url: 'https://current.example.app/', conversationId: 'first', embedCode }] },
    ],
    [
      'unavailable',
      { phase: 'failed', history: [{ url: 'https://current.example.app/', conversationId: 'first', embedCode }] },
    ],
  ])('explains %s without presenting misleading installation code', async (notice, overrides) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async () => status(overrides))
    );
    view();
    fireEvent.click(await screen.findByRole('button', { name: embedKey('embed'), exact: true }));
    expect(await screen.findByText(embedKey(notice as string))).toBeVisible();
    expect(screen.queryByRole('button', { name: embedKey('copyCode') })).not.toBeInTheDocument();
  });

  it('hides cached embed code when the refresh fails and restores it after retry', async () => {
    let failed = false;
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockImplementation(async () =>
          failed
            ? new Response(null, { status: 503 })
            : status({ history: [{ url: 'https://current.example.app/', conversationId: 'first', embedCode }] })
        )
    );
    view();
    const button = await screen.findByRole('button', { name: embedKey('embed'), exact: true });
    failed = true;
    fireEvent.click(button);
    expect(await screen.findByText(embedKey('unavailable'))).toBeVisible();
    expect(screen.queryByLabelText(embedKey('installationCode'))).not.toBeInTheDocument();
    failed = false;
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }));
    expect(await screen.findByLabelText(embedKey('installationCode'))).toHaveValue(embedCode);
  });

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
    expect(screen.getByRole('button', { name: 'preview.preview', exact: true })).toBeDisabled();
    expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
  });

  it.each([undefined, false, 'true'])(
    'keeps disconnected publishing disabled without a confirmed saved revision (%s)',
    async (savedRevisionAvailable) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockImplementation(async () => status({ connected: false, savedRevisionAvailable }));
      vi.stubGlobal('fetch', fetcher);
      view();
      await open();
      const publish = screen.getByRole('button', { name: key('publishApp') });
      expect(publish).toBeDisabled();
      fireEvent.click(publish);
      expect(fetcher.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
    }
  );

  it('opens preview with a native form containing only the selected conversation', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => status());
    vi.stubGlobal('fetch', fetcher);
    view('selected-conversation');
    await open();
    const button = screen.getByRole('button', { name: 'preview.preview', exact: true });
    const form = button.closest('form')!;
    expect(form).toHaveAttribute('action', '/api/platform/preview');
    expect(form).toHaveAttribute('method', 'post');
    expect(form).toHaveAttribute('target', '_blank');
    expect(form).toHaveAttribute('rel', 'noopener');
    const submitted = vi.fn((event: Event) => event.preventDefault());
    form.addEventListener('submit', submitted);
    fireEvent.click(button);
    expect(submitted).toHaveBeenCalledOnce();
    expect([...new FormData(form).entries()]).toEqual([['conversationId', 'selected-conversation']]);
    expect(fetcher.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
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

  it('waits past the status timeout for a streamed publishing result', async () => {
    let body: ReadableStreamDefaultController<Uint8Array>;
    let submitted: AbortSignal | null | undefined;
    const encoder = new TextEncoder();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
        if (init?.method !== 'POST') return status();
        submitted = init.signal;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              body = controller;
              controller.enqueue(encoder.encode('\n'));
              submitted?.addEventListener('abort', () => controller.error(new Error('Request aborted')));
            },
          }),
          { status: 202 }
        );
      })
    );
    view();
    await open();
    const publish = screen.getByRole('button', { name: key('publishApp') });
    await waitFor(() => expect(publish).toBeEnabled());
    vi.useFakeTimers();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), milliseconds);
      return controller.signal;
    });
    try {
      fireEvent.click(publish);
      await act(async () => vi.advanceTimersByTimeAsync(16000));
      expect(submitted?.aborted).toBe(false);
      await act(async () => {
        body.enqueue(
          encoder.encode(
            await status({ history: [{ url: 'https://streamed.example.app/', conversationId: 'first' }] }).text()
          )
        );
        body.close();
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByRole('link', { name: key('openApp') })).toHaveAttribute(
        'href',
        'https://streamed.example.app/'
      );
    } finally {
      timeout.mockRestore();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ownerId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
const runtimeGeneration = '33333333-3333-4333-8333-333333333333';
const context = { ownerId, projectId, logicalId: 'logical', coreId: 'core', runtimeGeneration, headGeneration: 4 };
const runtime = {
  state: 'running',
  can_send_message: false,
  has_task: true,
  task_status: 'running',
  is_processing: true,
  pending_confirmations: 0,
  turn_id: 'actual-turn',
};

class FakeSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;
  send = vi.fn();
  constructor(readonly url: string) {
    super();
    FakeSocket.instances.push(this);
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }
  close() {
    this.readyState = FakeSocket.CLOSED;
    this.dispatchEvent(new CloseEvent('close', { code: 1000 }));
  }
  message(name: string, data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ name, data }) }));
  }
}

async function loadGate(metadata: unknown = { mode: 'central-read', ownerId, projectId }) {
  window.__BUILDER_WORKSPACE__ = metadata;
  return import('@/common/adapter/httpBridge');
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  FakeSocket.instances = [];
  delete window.__backendPort;
  vi.stubGlobal('electronAPI', undefined);
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});
afterEach(() => {
  delete window.__BUILDER_WORKSPACE__;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('central read native activation', () => {
  it('reads central transcripts but rejects native settings, leases, ensure and mutations before fetch', async () => {
    const gate = await loadGate();
    const fetchMock = vi.fn(async () => Response.json({ success: true, data: { items: [] } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(gate.httpRequest('GET', '/api/conversations/core/messages?limit=50')).resolves.toEqual({ items: [] });
    await Promise.all(
      [
        ['GET', '/api/settings/client'],
        ['GET', '/api/projects/project'],
        ['POST', '/api/conversations/core/active-lease'],
        ['POST', '/api/conversations/core/runtime/ensure'],
        ['POST', '/api/conversations/core/messages'],
      ].map(([method, path]) =>
        expect(gate.httpRequest(method, path)).rejects.toMatchObject({ code: 'NATIVE_RUNTIME_INACTIVE' })
      )
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps settings initialization and authentication refresh VM-free while inactive, then loads settings on activation', async () => {
    const gate = await loadGate();
    const { configService } = await import('@/common/config/configService');
    const { refreshSession } = await import('@/common/adapter/sessionRefresh');
    const fetchMock = vi.fn(async () => Response.json({ data: { theme: 'dark' } }));
    vi.stubGlobal('fetch', fetchMock);
    await configService.initialize();
    await expect(refreshSession()).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    gate.activateNativeRuntime(context, 0);
    await configService.initialize();
    expect(configService.isInitialized()).toBe(true);
  });

  it('defers both sockets, retains subscriptions, drops inactive commands, and reconnects only after activation', async () => {
    const gate = await loadGate();
    const { bridge } = await import('@/common/platform/bridge');
    await import('@/common/adapter/browser');
    const listener = vi.fn();
    gate.wsEmitter('conversation.stream').on(listener);
    bridge.emit('native-command', { forbidden: true });
    expect(gate.wsSend('fs', { forbidden: true })).toBe(false);
    expect(FakeSocket.instances).toHaveLength(0);
    gate.activateNativeRuntime(context, 0);
    expect(FakeSocket.instances).toHaveLength(2);
    FakeSocket.instances.forEach((socket) => socket.open());
    expect(FakeSocket.instances.every((socket) => socket.send.mock.calls.length === 0)).toBe(true);
    FakeSocket.instances
      .find((socket) => socket.url.startsWith('ws:'))
      ?.message('conversation.stream', { id: 'stored-listener' });
    expect(listener).toHaveBeenCalledWith({ id: 'stored-listener' });
    gate.suspendNativeRuntime();
    await vi.advanceTimersByTimeAsync(30000);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it('keeps malformed supplied metadata inactive and rejects a different owner or stale activation epoch', async () => {
    const gate = await loadGate({ mode: 'central-read', ownerId: 'invalid', projectId });
    expect(gate.isNativeRuntimeActive()).toBe(false);
    expect(() => gate.activateNativeRuntime(context, 0)).toThrow();
  });

  it('permits original receipt GETs while inactive and blocks request sends or reconciliation before fetch', async () => {
    await loadGate();
    const { submitNativeRequest } = await import('@/renderer/pages/conversation/platforms/aionrs/durableAdmission');
    const requestId = '44444444-4444-4444-8444-444444444444';
    const pending = {
      requestId,
      context: { logicalId: 'logical', coreId: 'original-core', runtimeGeneration, headGeneration: 1 },
    };
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(submitNativeRequest(pending, 'Original prompt', 'lookup')).resolves.toBeNull();
    await expect(submitNativeRequest(pending, 'Original prompt', 'send')).rejects.toMatchObject({ status: 503 });
    await expect(submitNativeRequest(pending, 'Original prompt', 'reconcile')).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/platform/conversations/original-core/requests/${requestId}`,
      expect.objectContaining({ method: 'GET' })
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects stale head and mismatched resume response without activating native access', async () => {
    const gate = await loadGate();
    const { resumeNativeRuntime } = await import('@/renderer/pages/conversation/platforms/aionrs/durableAdmission');
    const fetchMock = vi.fn(async (url: string) =>
      Response.json(
        url.endsWith('/requests')
          ? { protocol: 1, ...context }
          : { ...context, runtimeGeneration: crypto.randomUUID(), runtime }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(resumeNativeRuntime({ ...context, headGeneration: 3 })).rejects.toMatchObject({ status: 409 });
    await expect(resumeNativeRuntime(context)).rejects.toMatchObject({ status: 409 });
    expect(gate.isNativeRuntimeActive()).toBe(false);
  });

  it('rejects a valid UUID owned by another account in both the resume response and activation context', async () => {
    const gate = await loadGate();
    const { resumeNativeRuntime } = await import('@/renderer/pages/conversation/platforms/aionrs/durableAdmission');
    const otherOwner = '55555555-5555-4555-8555-555555555555';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        Response.json(
          url.endsWith('/requests') ? { protocol: 1, ...context } : { ...context, ownerId: otherOwner, runtime }
        )
      )
    );
    await expect(resumeNativeRuntime(context)).rejects.toMatchObject({ status: 409 });
    expect(() => gate.activateNativeRuntime({ ...context, ownerId: otherOwner }, 0)).toThrow();
    expect(gate.isNativeRuntimeActive()).toBe(false);
  });

  it('keeps transport errors and protocol-zero capabilities inactive without posting resume', async () => {
    const gate = await loadGate();
    const { resumeNativeRuntime } = await import('@/renderer/pages/conversation/platforms/aionrs/durableAdmission');
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('lost response'))
      .mockResolvedValueOnce(Response.json({ protocol: 0, ownerId, projectId }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(resumeNativeRuntime(context)).rejects.toThrow('lost response');
    await expect(resumeNativeRuntime(context)).rejects.toMatchObject({ status: 409 });
    expect(fetchMock.mock.calls.every(([url]) => String(url).endsWith('/requests'))).toBe(true);
    expect(gate.isNativeRuntimeActive()).toBe(false);
  });

  it('keeps a lost resume response inactive even after the server accepted the fenced request', async () => {
    const gate = await loadGate();
    const { resumeNativeRuntime } = await import('@/renderer/pages/conversation/platforms/aionrs/durableAdmission');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ protocol: 1, ...context }))
        .mockRejectedValueOnce(new Error('lost resume response'))
    );
    await expect(resumeNativeRuntime(context)).rejects.toThrow('lost resume response');
    expect(gate.isNativeRuntimeActive()).toBe(false);
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('activates both browser transports with the actual running summary only after a fresh validated resume response', async () => {
    const gate = await loadGate();
    await import('@/common/adapter/browser');
    gate.wsEmitter('conversation.stream').on(() => {});
    const { resumeNativeRuntime } = await import('@/renderer/pages/conversation/platforms/aionrs/durableAdmission');
    const { runtimeResumed, getConversationRuntimeViewSnapshot } =
      await import('@/renderer/pages/conversation/runtime/conversationRuntimeViewStore');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        Response.json(url.endsWith('/requests') ? { protocol: 1, ...context } : { ...context, runtime })
      )
    );
    const resumed = await resumeNativeRuntime(context);
    expect(FakeSocket.instances).toHaveLength(0);
    runtimeResumed(resumed.coreId, resumed.runtime);
    gate.activateNativeRuntime(resumed, resumed.activationEpoch);
    expect(FakeSocket.instances).toHaveLength(2);
    expect(getConversationRuntimeViewSnapshot('core')).toMatchObject({
      isProcessing: true,
      canSendMessage: false,
      activeTurnId: 'actual-turn',
    });
  });

  it('uses the exact captured generation and actual runtime, and invalidates stale activation after a committed head change', async () => {
    const gate = await loadGate();
    const { resumeNativeRuntime } = await import('@/renderer/pages/conversation/platforms/aionrs/durableAdmission');
    const fetchMock = vi.fn(async (url: string, _options?: RequestInit) =>
      Response.json(url.endsWith('/requests') ? { protocol: 1, ...context } : { ...context, runtime })
    );
    vi.stubGlobal('fetch', fetchMock);
    const resumed = await resumeNativeRuntime(context);
    expect(resumed.runtime).toMatchObject({ state: 'running', can_send_message: false, turn_id: 'actual-turn' });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body))).toEqual({
      logicalId: 'logical',
      coreId: 'core',
      runtimeGeneration,
      headGeneration: 4,
    });
    gate.suspendNativeRuntime();
    expect(() => gate.activateNativeRuntime(resumed, resumed.activationEpoch)).toThrow();
    expect(gate.isNativeRuntimeActive()).toBe(false);
  });

  it('preserves legacy connection and native settings behavior when boot metadata is absent', async () => {
    delete window.__BUILDER_WORKSPACE__;
    const gate = await import('@/common/adapter/httpBridge');
    const fetchMock = vi.fn(async () => Response.json({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await import('@/common/adapter/browser');
    await gate.httpRequest('GET', '/api/settings/client');
    expect(gate.isNativeRuntimeActive()).toBe(true);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TChatConversation } from '@/common/config/storage';
import ChatConversation from '@/renderer/pages/conversation/components/ChatConversation';
import { useConversationContextSafe } from '@/renderer/hooks/context/ConversationContext';

const centralGate = vi.hoisted(() => ({
  enabled: false,
  active: false,
  epoch: 0,
  context: null as Record<string, unknown> | null,
  listeners: new Set<() => void>(),
}));
const resumeRuntime = vi.hoisted(() => vi.fn());
const activeLease = vi.hoisted(() => vi.fn());
const artifacts = vi.hoisted(() => vi.fn());
vi.mock('@/common/adapter/httpBridge', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getBuilderWorkspace: () =>
    centralGate.enabled
      ? {
          mode: 'central-read',
          ownerId: '11111111-1111-4111-8111-111111111111',
          projectId: '22222222-2222-4222-8222-222222222222',
        }
      : null,
  isNativeRuntimeActive: () => !centralGate.enabled || centralGate.active,
  getActiveNativeRuntimeContext: () => centralGate.context,
  nativeRuntimeActivationEpoch: () => centralGate.epoch,
  subscribeNativeRuntimeActivation: (listener: () => void) => {
    centralGate.listeners.add(listener);
    return () => centralGate.listeners.delete(listener);
  },
  activateNativeRuntime: (context: Record<string, unknown>) => {
    centralGate.context = context;
    centralGate.active = true;
    centralGate.epoch += 1;
    centralGate.listeners.forEach((listener) => listener());
  },
}));
vi.mock('@/renderer/pages/conversation/platforms/aionrs/durableAdmission', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resumeNativeRuntime: resumeRuntime,
}));
vi.mock('@/renderer/pages/conversation/hooks/useActiveLease', () => ({ useActiveLease: activeLease }));

const usePresetAssistantInfoMock = vi.fn();
const acpChatMock = vi.fn(() => <div data-testid='mock-acp-chat'>acp chat</div>);
const acpModelSelectorMock = vi.fn(() => <div data-testid='mock-acp-model-selector'>model selector</div>);

vi.mock('@/renderer/pages/conversation/Messages/MessageList', () => ({
  default: ({ className }: { className?: string }) => {
    const context = useConversationContextSafe();
    return (
      <div className={className}>
        message history<output data-testid='transcript-context'>{JSON.stringify(context)}</output>
      </div>
    );
  },
}));

vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  MessageListLoadingProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  MessageListProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  MessagePaginationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useMessageLstCache: vi.fn(),
}));

vi.mock('@/renderer/pages/conversation/Messages/artifacts', () => ({
  ConversationArtifactProvider: ({ children, ...props }: { children: React.ReactNode; enabled?: boolean }) => {
    artifacts(props);
    return <>{children}</>;
  },
}));

vi.mock('@/renderer/pages/conversation/components/ChatLayout', () => ({
  default: ({ children, headerExtra }: { children: React.ReactNode; headerExtra?: React.ReactNode }) => (
    <div>
      {headerExtra}
      {children}
    </div>
  ),
}));

vi.mock('@/renderer/pages/conversation/platforms/acp/AcpChat', () => ({
  __esModule: true,
  default: (props: unknown) => acpChatMock(props),
}));

vi.mock('@/renderer/components/agent/AcpModelSelector', () => ({
  __esModule: true,
  default: (props: unknown) => acpModelSelectorMock(props),
}));

vi.mock('@/renderer/pages/conversation/components/ChatSlider.tsx', () => ({
  default: () => <div>slider</div>,
}));

vi.mock('@/renderer/pages/cron', () => ({
  CronJobManager: () => <div>cron</div>,
}));

vi.mock('@/renderer/hooks/agent/usePresetAssistantInfo', () => ({
  resolveAssistantConfigId: () => undefined,
  usePresetAssistantInfo: (...args: unknown[]) => usePresetAssistantInfoMock(...args),
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({ openPreview: vi.fn() }),
}));

function legacyConversation(type: 'gemini' | 'codex' | 'openclaw-gateway' | 'nanobot' | 'remote'): TChatConversation {
  return {
    id: `conv-${type}`,
    user_id: 'user-1',
    name: `${type} history`,
    type,
    model: {},
    extra: { workspace: '/tmp/aionui-history' },
    status: 'finished',
    source: 'aionui',
    created_at: 1,
    modified_at: 1,
    pinned: false,
  } as TChatConversation;
}

describe('ChatConversation legacy runtime rendering', () => {
  beforeEach(() => {
    usePresetAssistantInfoMock.mockReset();
    acpChatMock.mockClear();
    acpModelSelectorMock.mockClear();
    centralGate.enabled = false;
    centralGate.active = false;
    centralGate.context = null;
    centralGate.epoch = 0;
    activeLease.mockClear();
    artifacts.mockClear();
    resumeRuntime.mockReset();
    sessionStorage.clear();
    usePresetAssistantInfoMock.mockReturnValue({ info: undefined, isLoading: false });
  });

  it.each(['gemini', 'codex', 'openclaw-gateway', 'nanobot', 'remote'] as const)(
    'renders %s history without the old runtime chat',
    (type) => {
      render(<ChatConversation conversation={legacyConversation(type)} />);

      expect(screen.getByText('message history')).toBeInTheDocument();
      expect(screen.queryByTestId('legacy-openclaw-chat')).not.toBeInTheDocument();
      expect(screen.queryByTestId('legacy-nanobot-chat')).not.toBeInTheDocument();
      expect(screen.queryByTestId('legacy-remote-chat')).not.toBeInTheDocument();
    }
  );

  it('prefers preset assistant backend over legacy extra backend for ACP conversations', () => {
    usePresetAssistantInfoMock.mockReturnValue({
      info: {
        name: 'Research Assistant',
        logo: '📚',
        isEmoji: true,
        backend: 'codex',
        assistantId: 'assistant-research',
      },
      isLoading: false,
    });

    render(
      <ChatConversation
        conversation={
          {
            id: 'conv-acp',
            user_id: 'user-1',
            name: 'ACP history',
            type: 'acp',
            model: {},
            extra: { workspace: '/tmp/aionui-history', backend: 'claude' },
            status: 'finished',
            source: 'aionui',
            created_at: 1,
            modified_at: 1,
            pinned: false,
          } as TChatConversation
        }
      />
    );

    expect(screen.getByTestId('mock-acp-chat')).toBeInTheDocument();
    expect(acpChatMock).toHaveBeenCalled();
    expect(acpChatMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        backend: 'codex',
        assistantId: 'assistant-research',
      })
    );
  });

  it('passes the resolved assistant backend to the ACP model selector for ACP conversations', () => {
    usePresetAssistantInfoMock.mockReturnValue({
      info: {
        name: 'Research Assistant',
        logo: '📚',
        isEmoji: true,
        backend: 'codex',
        assistantId: 'assistant-research',
      },
      isLoading: false,
    });

    render(
      <ChatConversation
        conversation={
          {
            id: 'conv-acp',
            user_id: 'user-1',
            name: 'ACP history',
            type: 'acp',
            model: {},
            extra: { workspace: '/tmp/aionui-history', backend: 'claude', current_model_id: 'model-1' },
            status: 'finished',
            source: 'aionui',
            created_at: 1,
            modified_at: 1,
            pinned: false,
          } as TChatConversation
        }
      />
    );

    expect(screen.getByTestId('mock-acp-model-selector')).toBeInTheDocument();
    expect(acpModelSelectorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: 'conv-acp',
        backend: 'codex',
        initialModelId: 'model-1',
        waitForWarmup: true,
      })
    );
  });

  it('reuses a widget transcript with actual conversation type and no native startup, lease, model or artifact read', () => {
    centralGate.enabled = true;
    const conversation = {
      ...legacyConversation('gemini'),
      id: 'core',
      type: 'aionrs',
      logical_conversation_id: 'logical',
      head_generation: 2,
      runtime_generation: '33333333-3333-4333-8333-333333333333',
      extra: { outputType: 'widget' },
    } as TChatConversation;
    render(<ChatConversation conversation={conversation} />);
    expect(JSON.parse(screen.getByTestId('transcript-context').textContent!)).toMatchObject({
      type: 'aionrs',
      isWidget: true,
      hideSendBox: true,
      readOnly: true,
    });
    expect(activeLease).not.toHaveBeenCalled();
    expect(usePresetAssistantInfoMock).not.toHaveBeenCalled();
    expect(artifacts).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  it('keeps a failed resume readonly and never mounts native controls', async () => {
    centralGate.enabled = true;
    resumeRuntime.mockRejectedValue(new Error('lost response'));
    const conversation = {
      ...legacyConversation('gemini'),
      id: 'core',
      type: 'acp',
      logical_conversation_id: 'logical',
      head_generation: 2,
      runtime_generation: '33333333-3333-4333-8333-333333333333',
    } as TChatConversation;
    render(<ChatConversation conversation={conversation} />);
    fireEvent.click(screen.getByRole('button', { name: 'conversation.centralRead.resume' }));
    await screen.findByRole('alert');
    expect(centralGate.active).toBe(false);
    expect(activeLease).not.toHaveBeenCalled();
    expect(screen.queryByTestId('mock-acp-chat')).not.toBeInTheDocument();
  });

  it('mounts the existing native view only after validated resume returns the same continuation and actual runtime', async () => {
    centralGate.enabled = true;
    const conversation = {
      ...legacyConversation('gemini'),
      id: 'core',
      type: 'acp',
      logical_conversation_id: 'logical',
      head_generation: 2,
      runtime_generation: '33333333-3333-4333-8333-333333333333',
    } as TChatConversation;
    resumeRuntime.mockResolvedValue({
      ownerId: '11111111-1111-4111-8111-111111111111',
      projectId: '22222222-2222-4222-8222-222222222222',
      logicalId: 'logical',
      coreId: 'core',
      headGeneration: 2,
      runtimeGeneration: conversation.runtime_generation,
      activationEpoch: 0,
      runtime: {
        state: 'running',
        can_send_message: false,
        has_task: true,
        task_status: 'running',
        is_processing: true,
        pending_confirmations: 0,
        turn_id: 'actual-turn',
      },
    });
    render(<ChatConversation conversation={conversation} />);
    fireEvent.click(screen.getByRole('button', { name: 'conversation.centralRead.resume' }));
    await waitFor(() => expect(screen.getByTestId('mock-acp-chat')).toBeInTheDocument());
    expect(resumeRuntime).toHaveBeenCalledWith({
      logicalId: 'logical',
      coreId: 'core',
      headGeneration: 2,
      runtimeGeneration: conversation.runtime_generation,
    });
    expect(centralGate.context).toMatchObject({ coreId: 'core', runtimeGeneration: conversation.runtime_generation });
  });

  it('shows an earlier pending intent and reads its original receipt while the new continuation remains readonly', async () => {
    centralGate.enabled = true;
    const requestId = '44444444-4444-4444-8444-444444444444';
    const context = {
      logicalId: 'logical',
      coreId: 'old-core',
      runtimeGeneration: '33333333-3333-4333-8333-333333333333',
      headGeneration: 1,
    };
    const item = {
      id: 'earlier',
      input: 'Keep my original prompt',
      files: [],
      created_at: 1,
      pending: true,
      request: { requestId, context },
    };
    const storageKey =
      'conversation-command-queue/scoped/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/old-core';
    const stored = JSON.stringify({ items: [item], mode: 'manual', isPaused: true });
    sessionStorage.setItem(storageKey, stored);
    const fetchMock = vi.fn(async () =>
      Response.json({
        requestId,
        context,
        prompt: { client_request_id: requestId, content: item.input, hidden: false },
        receipt: { client_request_id: requestId, turn_id: 'old-turn', msg_id: 'old-message' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const conversation = {
      ...legacyConversation('gemini'),
      id: 'new-core',
      type: 'aionrs',
      logical_conversation_id: 'logical',
      head_generation: 2,
      runtime_generation: context.runtimeGeneration,
    } as TChatConversation;
    render(<ChatConversation conversation={conversation} />);
    await screen.findByText('conversation.commandQueue.requestRecorded');
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/platform/conversations/old-core/requests/${requestId}`,
      expect.objectContaining({ method: 'GET' })
    );
    expect(sessionStorage.getItem(storageKey)).toBe(stored);
    expect(activeLease).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

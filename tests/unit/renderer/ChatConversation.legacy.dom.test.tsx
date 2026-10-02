import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TChatConversation } from '@/common/config/storage';
import ChatConversation from '@/renderer/pages/conversation/components/ChatConversation';

const native = vi.hoisted(() => ({
  busy: false,
  warning: vi.fn(),
  error: vi.fn(),
  update: vi.fn(),
  stop: vi.fn(),
  refresh: vi.fn(),
  onSelect: null as null | ((provider: unknown, model: string) => Promise<boolean>),
}));
vi.mock('@arco-design/web-react', async (importOriginal) => {
  const original = await importOriginal<typeof import('@arco-design/web-react')>();
  return { ...original, Message: { ...original.Message, warning: native.warning, error: native.error } };
});
vi.mock('@/common', () => ({
  ipcBridge: { conversation: { update: { invoke: native.update }, stop: { invoke: native.stop } } },
}));
vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: vi.fn(),
  refreshConversationCache: native.refresh,
}));
vi.mock('@/renderer/pages/conversation/hooks/useActiveLease', () => ({ useActiveLease: vi.fn() }));
vi.mock('@/renderer/pages/conversation/runtime/useConversationRuntimeView', () => ({
  useConversationRuntimeView: () => ({
    canSendMessage: !native.busy,
    isProcessing: native.busy,
    activeTurnId: native.busy ? 'active-turn' : null,
  }),
}));
vi.mock('@/renderer/hooks/agent/useAcpConfigOptions', () => ({
  classifyConfigSetError: () => 'unknown',
  useAcpConfigOptions: () => ({ thoughtLevel: null, setStatus: { state: 'idle' } }),
}));
vi.mock('@/renderer/pages/conversation/platforms/aionrs/useAionrsModelSelection', () => ({
  useAionrsModelSelection: (options: { onSelectModel: typeof native.onSelect }) => {
    native.onSelect = options.onSelectModel;
    return {};
  },
}));
vi.mock('@/renderer/pages/conversation/platforms/aionrs/AionrsModelSelector', () => ({
  default: () => <div data-testid='header-native-model-selector' />,
}));
vi.mock('@/renderer/pages/conversation/platforms/aionrs/AionrsChat', () => ({
  default: () => <div data-testid='native-chat'>native history</div>,
}));

const usePresetAssistantInfoMock = vi.fn();
const acpChatMock = vi.fn(() => <div data-testid='mock-acp-chat'>acp chat</div>);
const acpModelSelectorMock = vi.fn(() => <div data-testid='mock-acp-model-selector'>model selector</div>);

vi.mock('@/renderer/pages/conversation/Messages/MessageList', () => ({
  default: ({ className }: { className?: string }) => <div className={className}>message history</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  MessageListLoadingProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  MessageListProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  MessagePaginationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useMessageLstCache: vi.fn(),
}));

vi.mock('@/renderer/pages/conversation/Messages/artifacts', () => ({
  ConversationArtifactProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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
    vi.stubGlobal('electronAPI', undefined);
    native.busy = false;
    native.warning.mockClear();
    native.error.mockClear();
    native.update.mockReset().mockResolvedValue(true);
    native.stop.mockReset();
    native.refresh.mockReset().mockResolvedValue(undefined);
    usePresetAssistantInfoMock.mockReset();
    acpChatMock.mockClear();
    acpModelSelectorMock.mockClear();
    usePresetAssistantInfoMock.mockReturnValue({ info: undefined, isLoading: false });
  });

  const nativeConversation = () =>
    ({ ...legacyConversation('gemini'), id: 'native-conversation', type: 'aionrs' }) as TChatConversation;

  it('opens native history with its composer-owned selector and no duplicate browser header selector', () => {
    render(<ChatConversation conversation={nativeConversation()} />);
    expect(screen.getByTestId('native-chat')).toHaveTextContent('native history');
    expect(screen.queryByTestId('header-native-model-selector')).not.toBeInTheDocument();
  });

  it('does not stop an active customer turn or issue a model PATCH', async () => {
    native.busy = true;
    render(<ChatConversation conversation={nativeConversation()} />);
    let accepted = true;
    await act(async () => {
      accepted = await native.onSelect!({ id: 'configured-provider' }, 'z-ai/glm-5.3');
    });
    expect(accepted).toBe(false);
    expect(native.stop).not.toHaveBeenCalled();
    expect(native.update).not.toHaveBeenCalled();
    expect(native.warning).toHaveBeenCalled();
  });

  it('changes only the model on the same conversation and refreshes canonical state after transport failure', async () => {
    native.update.mockRejectedValueOnce(new Error('lost acknowledgement'));
    render(<ChatConversation conversation={nativeConversation()} />);
    let accepted = true;
    await act(async () => {
      accepted = await native.onSelect!({ id: 'configured-provider' }, 'z-ai/glm-5.3');
    });
    expect(accepted).toBe(false);
    expect(native.refresh).toHaveBeenCalledWith('native-conversation');
    expect(native.error).toHaveBeenCalled();
    expect(native.stop).not.toHaveBeenCalled();
    expect(native.update).toHaveBeenCalledWith({
      id: 'native-conversation',
      updates: { model: { id: 'configured-provider', use_model: 'z-ai/glm-5.3' } },
    });
    await act(async () => {
      accepted = await native.onSelect!({ id: 'configured-provider' }, 'z-ai/glm-5.3');
    });
    expect(accepted).toBe(true);
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
});

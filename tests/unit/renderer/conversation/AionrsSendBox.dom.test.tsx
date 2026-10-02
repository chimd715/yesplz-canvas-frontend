import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Message } from '@arco-design/web-react';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import AionrsSendBox from '@/renderer/pages/conversation/platforms/aionrs/AionrsSendBox';
import type { AionrsModelSelection } from '@/renderer/pages/conversation/platforms/aionrs/useAionrsModelSelection';
import type { TeamSendBoxRuntime } from '@/renderer/pages/team/components/teamSendRuntime';
import {
  getQueue,
  queueScope,
  stageCustomerInitialPrompt,
  resetCustomerPromptQueuesForTest,
} from '@/renderer/pages/conversation/platforms/aionrs/PromptQueue/state';
import { MemoryRouter, Route, Routes, useNavigate, useParams } from 'react-router-dom';

const {
  ensureConversationRuntimeMock,
  sendMessageInvokeMock,
  translateMock,
  useTeamPermissionMock,
  setSendBoxHandlerMock,
  markSendFailedMock,
  markSendStartedMock,
  markSendAcceptedMock,
  sendBoxPropsSpy,
  enqueueMock,
  clearFilesMock,
  draftMutateMock,
  draftContentRef,
  runtimeViewIsProcessingRef,
  skillCatalogRef,
  mobileRef,
} = vi.hoisted(() => ({
  ensureConversationRuntimeMock: vi.fn().mockResolvedValue({ recovered: false, config_options: [], runtime: null }),
  sendMessageInvokeMock: vi.fn().mockResolvedValue(undefined),
  translateMock: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  useTeamPermissionMock: vi.fn(),
  setSendBoxHandlerMock: vi.fn(),
  markSendFailedMock: vi.fn(),
  markSendStartedMock: vi.fn(),
  markSendAcceptedMock: vi.fn(),
  sendBoxPropsSpy: vi.fn(),
  enqueueMock: vi.fn(),
  clearFilesMock: vi.fn(),
  draftMutateMock: vi.fn(),
  draftContentRef: { current: '' },
  runtimeViewIsProcessingRef: { current: false },
  skillCatalogRef: {
    current: [{ name: 'report', description: 'Create reports' }] as
      | Array<{ name: string; description: string }>
      | undefined,
  },
  mobileRef: { current: false },
}));

vi.mock('swr', () => ({ default: () => ({ data: skillCatalogRef.current }) }));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      turnCompleted: { on: vi.fn(() => () => {}) },
      sendMessage: {
        invoke: sendMessageInvokeMock,
      },
      stop: {
        invoke: vi.fn().mockResolvedValue(undefined),
      },
    },
  },
}));

vi.mock('@/renderer/components/chat/SendBox', () => ({
  default: ({
    onSend,
    onChange,
    active,
    onFocused,
    disabled,
    sendDisabled,
    rightTools,
    sendButtonPrefix,
    topRightOverlay,
    onAddToDraft,
    addToDraftDisabled,
    selectedSessions,
    onSelectedSessionsChange,
    crossSessionEnabled,
    isTeamConversation,
  }: {
    onSend: (message: string) => Promise<void>;
    onChange?: (value: string) => void;
    active?: boolean;
    onFocused?: () => void;
    disabled?: boolean;
    sendDisabled?: boolean;
    rightTools?: React.ReactNode;
    sendButtonPrefix?: React.ReactNode;
    topRightOverlay?: React.ReactNode;
    onAddToDraft?: () => void;
    addToDraftDisabled?: boolean;
    selectedSessions?: Array<{ id: string }>;
    onSelectedSessionsChange?: (sessions: Array<{ id: string }>) => void;
    crossSessionEnabled?: boolean;
    isTeamConversation?: boolean;
  }) => {
    sendBoxPropsSpy({
      onSend,
      active,
      onFocused,
      disabled,
      sendDisabled,
      onAddToDraft,
      addToDraftDisabled,
      selectedSessions,
      onSelectedSessionsChange,
      crossSessionEnabled,
      isTeamConversation,
    });
    return (
      <div>
        {rightTools}
        {sendButtonPrefix}
        {topRightOverlay}
        <button type='button' onClick={() => onChange?.('hello')}>
          change
        </button>
        <button
          type='button'
          onClick={() => {
            // Models the Enter-key submit path: in the real component Enter
            // reaches `onSend` regardless of the button's visual `sendDisabled`
            // state — the parent decides whether to block+toast.
            void onSend('Hello').catch(() => {});
          }}
        >
          send
        </button>
      </div>
    );
  },
}));

vi.mock('@/renderer/components/agent/AgentModeSelector', () => ({
  default: () => <div data-testid='permission-selector' />,
}));
vi.mock('@/renderer/pages/conversation/platforms/aionrs/AionrsModelSelector', () => ({
  default: ({ busy }: { busy?: boolean }) => (
    <button data-testid='customer-model-selector' disabled={busy}>
      Model
    </button>
  ),
}));
vi.mock('@/renderer/components/chat/CommandQueuePanel', () => ({ default: () => null }));
vi.mock('@/renderer/components/chat/MobileActionSheet', () => ({
  default: ({
    entries,
  }: {
    entries: Array<{ key: string; submenu?: { options?: Array<{ key: string }>; onSelect?: (key: string) => void } }>;
  }) => (
    <div>
      {entries.map((entry) => (
        <button
          key={entry.key}
          data-testid={`mobile-${entry.key}`}
          onClick={() => entry.submenu?.onSelect?.(entry.submenu.options?.[0]?.key ?? '')}
        >
          {entry.key}
        </button>
      ))}
    </div>
  ),
  useAttachEntry: () => ({ entries: [], hiddenFileInput: null }),
}));
vi.mock('@/renderer/components/chat/ThoughtDisplay', () => ({ default: () => null }));
vi.mock('@/renderer/components/media/FileAttachButton', () => ({ default: () => null }));
vi.mock('@/renderer/components/media/FilePreview', () => ({ default: () => null }));
vi.mock('@/renderer/components/media/HorizontalFileList', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/renderer/hooks/agent/useAcpConfigOptions', () => ({
  classifyConfigSetError: () => 'unknown',
  useAcpConfigOptions: () => ({
    setStatus: { state: 'idle' },
    mode: null,
    model: null,
    thoughtLevel: null,
    reload: vi.fn(),
    setConfigOption: vi.fn(),
  }),
}));
vi.mock('@/renderer/hooks/context/ConversationContext', () => ({
  useConversationContextSafe: () => ({
    loadedSkills: [],
    loadedMcpStatuses: [],
  }),
}));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: mobileRef.current }),
}));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ status: 'authenticated', user: { id: 'customer' } }),
}));
vi.mock('@/renderer/pages/conversation/platforms/aionrs/PromptQueue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/renderer/pages/conversation/platforms/aionrs/PromptQueue')>();
  return {
    ...actual,
    useCustomerPromptQueue: (...args: Parameters<typeof actual.useCustomerPromptQueue>) => {
      const queue = actual.useCustomerPromptQueue(...args);
      return {
        ...queue,
        enqueue: (...input: Parameters<typeof queue.enqueue>) => {
          enqueueMock(...input);
          return queue.enqueue(...input);
        },
      };
    },
  };
});
vi.mock('@/renderer/hooks/chat/useAutoTitle', () => ({
  useAutoTitle: () => ({
    checkAndUpdateTitle: vi.fn(),
  }),
}));
vi.mock('@/renderer/hooks/chat/useSendBoxDraft', () => ({
  getSendBoxDraftHook: () => () => ({
    data: {
      atPath: [],
      uploadFile: [],
      content: draftContentRef.current,
    },
    mutate: draftMutateMock,
  }),
}));
vi.mock('@/renderer/hooks/chat/useSendBoxFiles', () => ({
  useSendBoxFiles: () => ({
    handleFilesAdded: vi.fn(),
    clearFiles: clearFilesMock,
  }),
  createSetUploadFile: () => vi.fn(),
}));
vi.mock('@/renderer/hooks/chat/useSlashCommands', () => ({
  useSlashCommands: () => [],
}));
vi.mock('@/renderer/hooks/file/useOpenFileSelector', () => ({
  useOpenFileSelector: () => ({
    openFileSelector: vi.fn(),
    onSlashBuiltinCommand: vi.fn(),
  }),
}));
vi.mock('@/renderer/pages/conversation/platforms/useConversationCommandQueue', () => ({
  useConversationCommandQueue: () => ({
    items: [],
    isPaused: false,
    isInteractionLocked: false,
    hasPendingCommands: false,
    enqueue: enqueueMock,
    remove: vi.fn(),
    clear: vi.fn(),
    reorder: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    lockInteraction: vi.fn(),
    unlockInteraction: vi.fn(),
    resetActiveExecution: vi.fn(),
  }),
}));
vi.mock('@/renderer/pages/conversation/runtime/useConversationRuntimeView', () => ({
  useConversationRuntimeView: () => ({
    hydrated: true,
    canSendMessage: true,
    get isProcessing() {
      return runtimeViewIsProcessingRef.current;
    },
    state: 'idle',
    markSendStarted: markSendStartedMock,
    markSendAccepted: markSendAcceptedMock,
    markSendFailed: markSendFailedMock,
  }),
}));
vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: vi.fn().mockResolvedValue({
    extra: {
      workspace: '/tmp/workspace',
    },
  }),
}));
vi.mock('@/renderer/pages/conversation/utils/conversationCreateError', () => ({
  getConversationRuntimeWorkspaceErrorMessage: () => 'workspace failed',
}));
vi.mock('@/renderer/pages/conversation/utils/ensureConversationRuntime', () => ({
  ensureConversationRuntime: ensureConversationRuntimeMock,
}));
vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({
    setSendBoxHandler: setSendBoxHandlerMock,
  }),
}));
vi.mock('@/renderer/pages/team/hooks/TeamPermissionContext', () => ({
  useTeamPermission: useTeamPermissionMock,
}));
vi.mock('@/renderer/services/FileService', () => ({
  allSupportedExts: [],
}));
vi.mock('@/renderer/utils/emitter', () => ({
  emitter: {
    emit: vi.fn(),
  },
  useAddEventListener: vi.fn(),
}));
vi.mock('@/renderer/utils/file/fileSelection', () => ({
  mergeFileSelectionItems: vi.fn((items: unknown[]) => items),
}));
vi.mock('@/renderer/utils/file/messageFiles', () => ({
  collectChatFileRefs: () => [],
  splitChatFileRefs: () => ({ uploadFiles: [], atPath: [] }),
}));
vi.mock('@arco-design/web-react', () => ({
  Message: {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
  Tag: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type='button' onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock('@icon-park/react', () => ({
  Brain: () => null,
  MagicHat: () => null,
  Shield: () => null,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translateMock }),
}));
vi.mock('@/renderer/pages/conversation/platforms/aionrs/useAionrsMessage', () => ({
  useAionrsMessage: () => ({
    thought: { subject: '', description: '' },
    running: false,
    setActiveMsgId: vi.fn(),
    setWaitingResponse: vi.fn(),
    resetState: vi.fn(),
  }),
}));

const modelSelection = {
  current_model: {
    provider_id: 'openai',
    model: 'gpt-4.1',
    use_model: 'openai/gpt-4.1',
  },
} as AionrsModelSelection;

const ExistingChatRoute = () => {
  const { id } = useParams();
  return <AionrsSendBox conversation_id={id!} modelSelection={modelSelection} />;
};

const ChatNavigation = () => {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => void navigate('/conversation/conv-1')}>open conversation</button>
      <button onClick={() => void navigate(-1)}>browser back</button>
      <Routes>
        <Route path='/' element={<div>home</div>} />
        <Route path='/conversation/:id' element={<ExistingChatRoute />} />
      </Routes>
    </>
  );
};

describe('AionrsSendBox', () => {
  it('automatically prepares chat and sends the home-staged prompt and upload exactly once', async () => {
    const files = [{ kind: 'upload' as const, path: 'customer-upload.csv' }];
    expect(stageCustomerInitialPrompt('customer', 'conv-1', { input: '$report summarize', files })).toBe('accepted');
    const { unmount } = render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
    await waitFor(() => expect(sendMessageInvokeMock).toHaveBeenCalledOnce());
    expect(ensureConversationRuntimeMock).toHaveBeenCalled();
    expect(sendMessageInvokeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: 'conv-1',
        input: '$report summarize',
        files,
        inject_skills: ['report'],
      })
    );
    unmount();
    render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
    expect(sendMessageInvokeMock).toHaveBeenCalledOnce();
  });

  it('keeps a rejected first prompt visible in the scoped queue without silently resending it', async () => {
    sendMessageInvokeMock.mockRejectedValue(
      new BackendHttpError({ method: 'POST', path: '/api/conversations/conv-1/messages', status: 400, body: {} })
    );
    stageCustomerInitialPrompt('customer', 'conv-1', { input: 'first request', files: [] });
    render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
    await waitFor(() => expect(getQueue(queueScope('customer', 'conv-1')).active?.status).toBe('failed'));
    expect(sendMessageInvokeMock).toHaveBeenCalledOnce();
    expect(screen.getByText('first request')).toBeInTheDocument();
  });
  beforeEach(() => {
    vi.stubGlobal('electronAPI', undefined);
    vi.clearAllMocks();
    sessionStorage.clear();
    resetCustomerPromptQueuesForTest();
    sendMessageInvokeMock.mockResolvedValue({ msg_id: 'message', turn_id: 'turn', runtime: { is_processing: false } });
    ensureConversationRuntimeMock.mockResolvedValue({ recovered: false, config_options: [], runtime: null });
    useTeamPermissionMock.mockReturnValue(null);
    draftContentRef.current = '';
    runtimeViewIsProcessingRef.current = false;
    skillCatalogRef.current = [{ name: 'report', description: 'Create reports' }];
    mobileRef.current = false;
  });

  it('sends an exact available skill reference through the native skill injection contract', async () => {
    render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    await act(async () => sendBoxPropsSpy.mock.calls.at(-1)?.[0].onSend('Please use $report'));
    await waitFor(() => expect(sendMessageInvokeMock).toHaveBeenCalledTimes(1));
    expect(sendMessageInvokeMock).toHaveBeenCalledWith(
      expect.objectContaining({ input: 'Please use $report', inject_skills: ['report'] })
    );
  });

  it('rejects unavailable skill names before queue admission or API calls and preserves the draft', async () => {
    render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    let accepted: unknown;
    await act(async () => {
      accepted = await sendBoxPropsSpy.mock.calls.at(-1)?.[0].onSend('$reports');
    });
    expect(accepted).toBe(false);
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(clearFilesMock).not.toHaveBeenCalled();
    expect(draftMutateMock).not.toHaveBeenCalled();
  });

  it('revalidates skill availability before draining an accepted queued prompt', async () => {
    runtimeViewIsProcessingRef.current = true;
    const { rerender } = render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    await act(async () => sendBoxPropsSpy.mock.calls.at(-1)?.[0].onSend('$report'));
    skillCatalogRef.current = [];
    runtimeViewIsProcessingRef.current = false;
    rerender(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('conversation.customerQueue.failed'));
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
  });

  it('uses the model selector in place of browser permissions and blocks it while busy', async () => {
    const { rerender } = render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
    await waitFor(() => expect(screen.getByTestId('customer-model-selector')).not.toBeDisabled());
    expect(screen.queryByTestId('permission-selector')).not.toBeInTheDocument();
    runtimeViewIsProcessingRef.current = true;
    rerender(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
    expect(screen.getByTestId('customer-model-selector')).toBeDisabled();
  });

  it('holds queued prompts during model change and drains after selection settles', async () => {
    const { rerender } = render(
      <AionrsSendBox conversation_id='conv-1' modelSelection={{ ...modelSelection, isChanging: true }} />
    );
    await waitFor(() => expect(ensureConversationRuntimeMock).toHaveBeenCalled());
    const props = sendBoxPropsSpy.mock.calls.at(-1)?.[0];
    await act(async () => {
      await props.onSend('Queued during model change');
    });
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
    rerender(<AionrsSendBox conversation_id='conv-1' modelSelection={{ ...modelSelection, isChanging: false }} />);
    await waitFor(() => expect(sendMessageInvokeMock).toHaveBeenCalledOnce());
    expect(sendMessageInvokeMock.mock.calls[0][0].input).toContain('Queued during model change');
  });

  it('keeps the mobile model action, hides permissions, and refuses selection during an active turn', async () => {
    mobileRef.current = true;
    const select = vi.fn();
    const provider = { id: 'configured-provider', name: 'Configured', platform: 'custom', models: ['z-ai/glm-5.3'] };
    const mobileSelection = {
      ...modelSelection,
      providers: [provider],
      getAvailableModels: () => provider.models,
      handleSelectModel: select,
    } as AionrsModelSelection;
    const { rerender } = render(<AionrsSendBox conversation_id='conv-1' modelSelection={mobileSelection} />);
    await waitFor(() => expect(screen.getByTestId('customer-model-selector')).not.toBeDisabled());
    expect(screen.queryByTestId('mobile-permission')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mobile-model'));
    expect(select).toHaveBeenCalledWith(provider, 'z-ai/glm-5.3');
    select.mockClear();
    runtimeViewIsProcessingRef.current = true;
    rerender(<AionrsSendBox conversation_id='conv-1' modelSelection={mobileSelection} />);
    fireEvent.click(screen.getByTestId('mobile-model'));
    expect(select).not.toHaveBeenCalled();
  });

  it('does not warm up team session when draft content changes', async () => {
    const warmupSession = vi.fn().mockResolvedValue(undefined);
    useTeamPermissionMock.mockReturnValue({
      isTeamMode: true,
      isLeaderAgent: true,
      leaderConversationId: 'conv-1',
      allConversationIds: ['conv-1'],
      propagateMode: vi.fn(),
      warmupSession,
    });

    render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
    await waitFor(() => {
      expect(warmupSession).toHaveBeenCalled();
    });
    warmupSession.mockClear();

    await act(async () => {
      screen.getByRole('button', { name: 'change' }).click();
    });

    expect(warmupSession).not.toHaveBeenCalled();
  });

  it('still warms up team session before sending', async () => {
    const warmupSession = vi.fn().mockResolvedValue(undefined);
    useTeamPermissionMock.mockReturnValue({
      isTeamMode: true,
      isLeaderAgent: true,
      leaderConversationId: 'conv-1',
      allConversationIds: ['conv-1'],
      propagateMode: vi.fn(),
      warmupSession,
    });

    render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
    await waitFor(() => {
      expect(warmupSession).toHaveBeenCalled();
    });
    warmupSession.mockClear();

    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    await waitFor(() => {
      expect(warmupSession).toHaveBeenCalledTimes(1);
    });
  });

  it('does not start standalone runtime while preparing a team conversation', async () => {
    const warmupSession = vi.fn().mockResolvedValue(undefined);
    useTeamPermissionMock.mockReturnValue({
      isTeamMode: true,
      isLeaderAgent: true,
      leaderConversationId: 'conv-1',
      allConversationIds: ['conv-1'],
      propagateMode: vi.fn(),
      warmupSession,
    });

    render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);

    await waitFor(() => {
      expect(warmupSession).toHaveBeenCalled();
    });
    expect(ensureConversationRuntimeMock).not.toHaveBeenCalled();
  });

  it('uses runtime ensure instead of legacy warmup for standalone runtime preparation', async () => {
    render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);

    await waitFor(() => {
      expect(ensureConversationRuntimeMock).toHaveBeenCalledWith('conv-1');
    });
  });

  it('disables an oversized draft and blocks racing Enter before clearing attachments or calling the API', async () => {
    draftContentRef.current = 'x'.repeat(300_000);
    render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(sendBoxPropsSpy.mock.calls.at(-1)?.[0].sendDisabled).toBe(true);
    // Invoke the exact parent submission edge with the overlong value, even if
    // a stale disabled button/Enter handler managed to reach it.
    const send = sendBoxPropsSpy.mock.calls.at(-1)?.[0].onSend;
    await act(async () => {
      await send(draftContentRef.current);
    });
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
    expect(clearFilesMock).not.toHaveBeenCalled();
    expect(Message.error).toHaveBeenCalledWith('conversation.promptTooLarge');
  });

  it('automatically prepares a conversation again after leaving and reopening its route without sending a turn', async () => {
    render(
      <MemoryRouter>
        <ChatNavigation />
      </MemoryRouter>
    );
    await act(async () => screen.getByRole('button', { name: 'open conversation' }).click());
    await waitFor(() => expect(ensureConversationRuntimeMock).toHaveBeenCalledTimes(1));
    await act(async () => screen.getByRole('button', { name: 'browser back' }).click());
    expect(screen.queryByRole('button', { name: 'send' })).not.toBeInTheDocument();
    await act(async () => screen.getByRole('button', { name: 'open conversation' }).click());
    await waitFor(() => expect(ensureConversationRuntimeMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'send' })).toBeInTheDocument();
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
  });

  it('keeps the composer mounted and blocks racing Enter until automatic preparation completes', async () => {
    let ready!: () => void;
    ensureConversationRuntimeMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          ready = resolve;
        })
    );
    render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
    expect(screen.getByRole('status')).toHaveTextContent('conversation.entryRuntime.preparing');
    await act(async () => screen.getByRole('button', { name: 'send' }).click());
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
    expect(clearFilesMock).not.toHaveBeenCalled();
    await act(async () => ready());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows an actionable connection failure and retries without sending a duplicate turn', async () => {
    ensureConversationRuntimeMock.mockRejectedValueOnce(new Error('offline'));
    render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('conversation.entryRuntime.failed'));
    await act(async () => screen.getByRole('button', { name: 'send' }).click());
    expect(clearFilesMock).not.toHaveBeenCalled();
    await act(async () => screen.getByRole('button', { name: 'common.retry' }).click());
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
    expect(ensureConversationRuntimeMock).toHaveBeenCalledTimes(2);
  });

  it('accepts only one message when Enter is pressed twice before the response', async () => {
    let accepted!: (value: unknown) => void;
    sendMessageInvokeMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          accepted = resolve;
        })
    );
    render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
      screen.getByRole('button', { name: 'send' }).click();
    });
    expect(sendMessageInvokeMock).toHaveBeenCalledTimes(1);
    await act(async () => accepted({ msg_id: 'message', turn_id: 'turn', runtime: { is_processing: false } }));
  });

  it('waits for automatic preparation before forwarding a stored initial message exactly once', async () => {
    const key = 'aionrs_initial_message_conv-1';
    sessionStorage.setItem(key, JSON.stringify({ input: 'first question', files: [] }));
    let ready!: () => void;
    ensureConversationRuntimeMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          ready = resolve;
        })
    );
    render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
    await waitFor(() => expect(ensureConversationRuntimeMock).toHaveBeenCalledWith('conv-1'));
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
    await act(async () => ready());
    await waitFor(() => expect(sendMessageInvokeMock).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem(key)).toBeNull();
    sessionStorage.clear();
  });

  it('suppresses visible error and preserves runtime gate for active-turn busy conflicts', async () => {
    sendMessageInvokeMock.mockRejectedValue(
      new BackendHttpError({
        method: 'POST',
        path: '/api/conversations/conv-1/messages',
        status: 409,
        body: { success: false, code: 'CONFLICT', error: 'conversation conv-1 is already running' },
      })
    );

    render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
    await waitFor(() => expect(ensureConversationRuntimeMock).toHaveBeenCalledWith('conv-1'));

    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    await waitFor(() => {
      expect(sendMessageInvokeMock).toHaveBeenCalledTimes(1);
    });
    expect(markSendFailedMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'busy_conflict', busyKind: 'active_turn' })
    );
    expect(Message.error).not.toHaveBeenCalled();
  });

  it('passes teamRuntime.isActive and onFocus down to SendBox as active/onFocused', () => {
    const onFocus = vi.fn();
    render(
      <AionrsSendBox
        conversation_id='conv-1'
        modelSelection={modelSelection}
        teamRuntime={{ loading: false, startedAtMs: null, isActive: true, onFocus } as unknown as TeamSendBoxRuntime}
      />
    );
    const props = sendBoxPropsSpy.mock.calls.at(-1)?.[0] as { active?: boolean; onFocused?: () => void };
    expect(props.active).toBe(true);
    props.onFocused?.();
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it('blocks a racing fourth submission and retains the draft and attachments when the queue is full', async () => {
    runtimeViewIsProcessingRef.current = true;
    draftContentRef.current = 'fourth draft';
    render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    await act(async () => sendBoxPropsSpy.mock.calls.at(-1)?.[0].onSend('first'));
    await act(async () => sendBoxPropsSpy.mock.calls.at(-1)?.[0].onSend('second'));
    await act(async () => sendBoxPropsSpy.mock.calls.at(-1)?.[0].onSend('third'));
    expect(sendBoxPropsSpy.mock.calls.at(-1)?.[0].sendDisabled).toBe(true);
    let accepted: unknown;
    await act(async () => {
      accepted = await sendBoxPropsSpy.mock.calls.at(-1)?.[0].onSend('fourth');
    });
    expect(accepted).toBe(false);
    expect(clearFilesMock).toHaveBeenCalledTimes(3);
    expect(draftMutateMock).not.toHaveBeenCalled();
  });

  it('revalidates the latest selected model when an accepted draft leaves the queue', async () => {
    runtimeViewIsProcessingRef.current = true;
    const deepseek = {
      ...modelSelection,
      current_model: { ...modelSelection.current_model!, use_model: 'deepseek/deepseek-v4.1-flash' },
    };
    const glm = {
      ...modelSelection,
      current_model: { ...modelSelection.current_model!, use_model: 'z-ai/glm-5.3-flash' },
    };
    const { rerender } = render(<AionrsSendBox conversation_id='conv-1' modelSelection={deepseek} />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    await act(async () => sendBoxPropsSpy.mock.calls.at(-1)?.[0].onSend('x'.repeat(250_000)));
    runtimeViewIsProcessingRef.current = false;
    rerender(<AionrsSendBox conversation_id='conv-1' modelSelection={glm} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('conversation.customerQueue.failed'));
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
    rerender(<AionrsSendBox conversation_id='conv-1' modelSelection={deepseek} />);
    await act(async () => screen.getByRole('button', { name: 'common.retry' }).click());
    await waitFor(() => expect(sendMessageInvokeMock).toHaveBeenCalledTimes(1));
  });

  it('preserves desktop busy-send behavior and its existing explicit draft queue', async () => {
    vi.stubGlobal('electronAPI', {});
    runtimeViewIsProcessingRef.current = true;
    render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    await act(async () => sendBoxPropsSpy.mock.calls.at(-1)?.[0].onSend('busy'));
    expect(sendBoxPropsSpy.mock.calls.at(-1)?.[0].sendDisabled).toBe(true);
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
  });

  describe('mid-turn interjection controls', () => {
    it('keeps send available and queues Enter while replying without interrupting the active turn', async () => {
      runtimeViewIsProcessingRef.current = true;
      draftContentRef.current = 'hello world';

      render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
      await waitFor(() => expect(ensureConversationRuntimeMock).toHaveBeenCalledWith('conv-1'));

      const props = sendBoxPropsSpy.mock.calls.at(-1)?.[0] as { sendDisabled?: boolean };
      expect(props.sendDisabled).toBe(false);

      await act(async () => {
        screen.getByRole('button', { name: 'send' }).click();
      });

      expect(sendMessageInvokeMock).not.toHaveBeenCalled();
      expect(enqueueMock).toHaveBeenCalledWith({ input: 'Hello', files: [], sessions: undefined });
      expect(clearFilesMock).toHaveBeenCalledTimes(1);
      expect(Message.warning).not.toHaveBeenCalled();
    });

    it('sends normally while idle', async () => {
      runtimeViewIsProcessingRef.current = false;

      render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
      await waitFor(() => expect(ensureConversationRuntimeMock).toHaveBeenCalledWith('conv-1'));

      const props = sendBoxPropsSpy.mock.calls.at(-1)?.[0] as { sendDisabled?: boolean };
      expect(props.sendDisabled).toBe(false);

      await act(async () => {
        screen.getByRole('button', { name: 'send' }).click();
      });

      await waitFor(() => {
        expect(sendMessageInvokeMock).toHaveBeenCalledTimes(1);
      });
      expect(enqueueMock).toHaveBeenCalledTimes(1);
      expect(Message.warning).not.toHaveBeenCalled();
    });

    it('shows the add-to-draft-box entry with a non-empty draft while replying, and clicking it enqueues without executing', async () => {
      runtimeViewIsProcessingRef.current = true;
      draftContentRef.current = 'hello world';

      render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
      await waitFor(() => expect(ensureConversationRuntimeMock).toHaveBeenCalledWith('conv-1'));

      const props = sendBoxPropsSpy.mock.calls.at(-1)?.[0] as { onAddToDraft?: () => void };
      expect(props.onAddToDraft).toBeDefined();
      await act(async () => {
        props.onAddToDraft?.();
      });

      expect(enqueueMock).toHaveBeenCalledWith({ input: 'hello world', files: [], sessions: undefined });
      expect(sendMessageInvokeMock).not.toHaveBeenCalled();
      expect(clearFilesMock).toHaveBeenCalled();
      const updater = draftMutateMock.mock.calls.at(-1)?.[0] as (prev: { content: string }) => { content: string };
      expect(updater({ content: 'hello world' })).toEqual(expect.objectContaining({ content: '' }));
    });

    it('carries `@@` session references into the draft box and clears them from the send box', async () => {
      // The draft box is where the references are most likely to be lost:
      // enqueue rebuilds the item, and a message that reaches the agent without
      // its session block fails silently on both sides.
      runtimeViewIsProcessingRef.current = true;
      draftContentRef.current = 'hello world';

      render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
      await waitFor(() => expect(ensureConversationRuntimeMock).toHaveBeenCalledWith('conv-1'));

      type SessionProps = {
        onAddToDraft?: () => void;
        onSelectedSessionsChange?: (sessions: Array<{ id: string }>) => void;
        selectedSessions?: Array<{ id: string }>;
      };
      const latestProps = (): SessionProps => sendBoxPropsSpy.mock.calls.at(-1)?.[0] as SessionProps;

      await act(async () => {
        latestProps().onSelectedSessionsChange?.([{ id: 'conv_target' }]);
      });
      // Re-read: picking a session re-renders, so the previous props snapshot
      // holds a stale `onAddToDraft` closure over the empty selection.
      await act(async () => {
        latestProps().onAddToDraft?.();
      });

      expect(enqueueMock).toHaveBeenCalledWith(expect.objectContaining({ sessions: [{ id: 'conv_target' }] }));
      expect(latestProps().selectedSessions).toEqual([]);
    });

    it('shows the add-to-draft-box option while idle, as long as the draft is non-empty', async () => {
      // Visibility is keyed only to the draft, not to the agent's busy state —
      // clicking while idle is semantically fine (the queue's own mode governs).
      runtimeViewIsProcessingRef.current = false;
      draftContentRef.current = 'hello world';

      render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
      await waitFor(() => expect(ensureConversationRuntimeMock).toHaveBeenCalledWith('conv-1'));

      const props = sendBoxPropsSpy.mock.calls.at(-1)?.[0] as { onAddToDraft?: () => void };
      expect(props.onAddToDraft).toBeDefined();
    });

    it('disables the Draft box action with an empty draft, even while replying', async () => {
      runtimeViewIsProcessingRef.current = true;
      draftContentRef.current = '';

      render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
      await waitFor(() => expect(ensureConversationRuntimeMock).toHaveBeenCalledWith('conv-1'));

      const props = sendBoxPropsSpy.mock.calls.at(-1)?.[0] as {
        onAddToDraft?: () => void;
        addToDraftDisabled?: boolean;
      };
      expect(props.onAddToDraft).toBeDefined();
      expect(props.addToDraftDisabled).toBe(true);
    });
  });
});

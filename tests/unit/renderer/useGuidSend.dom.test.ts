/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMcpServer } from '@/common/config/storage';
import { useGuidSend, type GuidSendDeps } from '@/renderer/pages/guid/hooks/useGuidSend';
import {
  getQueue,
  queueScope,
  resetCustomerPromptQueuesForTest,
} from '@/renderer/pages/conversation/platforms/aionrs/PromptQueue/state';

const createConversationInvokeMock = vi.fn();
const swrMutateMock = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      create: {
        invoke: (...args: unknown[]) => createConversationInvokeMock(...args),
      },
    },
  },
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: {
    emit: vi.fn(),
  },
}));

vi.mock('swr', () => ({
  mutate: (...args: unknown[]) => swrMutateMock(...args),
}));

vi.mock('@/renderer/utils/workspace/workspaceHistory', () => ({
  updateWorkspaceTime: vi.fn(),
}));

vi.mock('@arco-design/web-react', () => ({
  Message: {
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

const createDeps = (): GuidSendDeps => ({
  input: 'hello',
  setInput: vi.fn(),
  files: [],
  setFiles: vi.fn(),
  dir: '',
  setDir: vi.fn(),
  setLoading: vi.fn(),
  loading: false,
  selectedAssistantId: 'assistant-1',
  selectedAssistantBackend: 'claude',
  selectedMode: 'bypassPermissions',
  selectedAcpModel: 'claude-opus',
  current_model: undefined,
  guidDisabledBuiltinSkills: undefined,
  guidEnabledSkills: undefined,
  assistantDefaultSkillIds: undefined,
  assistantDefaultDisabledBuiltinSkillIds: undefined,
  availableMcpServers: [{ id: 'mcp-user', name: 'User MCP', enabled: true, builtin: false } as IMcpServer],
  selectedMcpServerIds: ['mcp-user'],
  assistantDefaultMcpIds: undefined,
  isGoogleAuth: false,
  setMentionOpen: vi.fn(),
  setMentionQuery: vi.fn(),
  setMentionSelectorOpen: vi.fn(),
  setMentionActiveIndex: vi.fn(),
  navigate: vi.fn(() => Promise.resolve()) as never,
  t: vi.fn((key: string, options?: { defaultValue?: string }) => options?.defaultValue || key) as never,
  localeKey: 'zh-CN',
});

const customerDeps = (): GuidSendDeps => ({
  ...createDeps(),
  customerHome: true,
  customerAccountId: 'alice',
  selectedAssistantId: 'bare:aionrs',
  selectedAssistantBackend: 'aionrs',
  current_model: { id: 'configured-mock', use_model: 'mock-local' } as NonNullable<GuidSendDeps['current_model']>,
});
const deferredCreation = () => {
  let resolve!: (conversation: { id: string }) => void;
  const promise = new Promise<{ id: string }>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('useGuidSend', () => {
  it('creates an automatic standalone workspace, stages the uploaded first prompt, then opens chat directly', async () => {
    const deps = customerDeps();
    deps.files = [{ kind: 'upload', path: 'opaque-upload-ref' }];
    const { result } = renderHook(() => useGuidSend(deps));
    await act(async () => {
      expect(await result.current.handleSend()).toBe(true);
    });
    const request = createConversationInvokeMock.mock.calls[0][0];
    expect(request.extra).toEqual(
      expect.objectContaining({ workspace: '', custom_workspace: false, default_files: ['opaque-upload-ref'] })
    );
    expect(request.extra.teamId).toBeUndefined();
    expect(getQueue(queueScope('alice', 'conv-1')).items).toEqual([
      expect.objectContaining({ input: 'hello', files: deps.files }),
    ]);
    expect(deps.navigate).toHaveBeenCalledWith('/conversation/conv-1');
    expect(sessionStorage.getItem('aionrs_initial_message_conv-1')).toBeNull();
  });

  it.each(['missing model', 'missing assistant', 'missing account', 'invalid response'])(
    'keeps the draft when first submission has %s',
    async (reason) => {
      const deps = customerDeps();
      if (reason === 'missing model') deps.current_model = undefined;
      if (reason === 'missing assistant') deps.selectedAssistantId = null;
      if (reason === 'missing account') deps.customerAccountId = undefined;
      if (reason === 'invalid response') createConversationInvokeMock.mockResolvedValue(null);
      const { result } = renderHook(() => useGuidSend(deps));
      act(() => result.current.sendMessageHandler());
      await waitFor(() => expect(deps.setLoading).toHaveBeenLastCalledWith(false));
      expect(deps.setInput).not.toHaveBeenCalled();
      expect(deps.setFiles).not.toHaveBeenCalled();
      expect(deps.navigate).not.toHaveBeenCalled();
      if (reason !== 'invalid response') expect(createConversationInvokeMock).not.toHaveBeenCalled();
    }
  );

  it('does not wait for unrelated catalog refresh promises before entering chat', async () => {
    swrMutateMock.mockReturnValue(new Promise(() => {}));
    const deps = customerDeps();
    const { result } = renderHook(() => useGuidSend(deps));
    await act(async () => {
      expect(await result.current.handleSend()).toBe(true);
    });
    expect(deps.navigate).toHaveBeenCalledOnce();
  });

  it('synchronously prevents rapid Enter submissions from creating duplicate conversations or first prompts', async () => {
    const creation = deferredCreation();
    createConversationInvokeMock.mockReturnValue(creation.promise);
    const deps = customerDeps();
    const { result } = renderHook(() => useGuidSend(deps));
    act(() => {
      result.current.sendMessageHandler();
      result.current.sendMessageHandler();
      result.current.sendMessageHandler();
    });
    expect(createConversationInvokeMock).toHaveBeenCalledOnce();
    await act(async () => creation.resolve({ id: 'conv-1' }));
    await waitFor(() => expect(deps.navigate).toHaveBeenCalledOnce());
    expect(getQueue(queueScope('alice', 'conv-1')).items).toHaveLength(1);
  });

  it('reuses only a known returned conversation after storage failure and keeps the draft until handoff succeeds', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const deps = customerDeps();
    const { result } = renderHook(() => useGuidSend(deps));
    act(() => result.current.sendMessageHandler());
    await waitFor(() => expect(deps.setLoading).toHaveBeenLastCalledWith(false));
    expect(deps.setInput).not.toHaveBeenCalled();
    expect(deps.navigate).not.toHaveBeenCalled();
    storage.mockRestore();
    act(() => result.current.sendMessageHandler());
    await waitFor(() => expect(deps.navigate).toHaveBeenCalledOnce());
    expect(createConversationInvokeMock).toHaveBeenCalledOnce();
    expect(getQueue(queueScope('alice', 'conv-1')).items).toHaveLength(1);
  });

  it('retries failed navigation to the same conversation without duplicating its staged prompt', async () => {
    const deps = customerDeps();
    vi.mocked(deps.navigate).mockRejectedValueOnce(new Error('navigation failed'));
    const { result } = renderHook(() => useGuidSend(deps));
    await expect(result.current.handleSend()).rejects.toThrow('navigation failed');
    await act(async () => {
      await result.current.handleSend();
    });
    expect(createConversationInvokeMock).toHaveBeenCalledOnce();
    expect(getQueue(queueScope('alice', 'conv-1')).items).toHaveLength(1);
    expect(deps.navigate).toHaveBeenCalledTimes(2);
  });

  it('does not automatically retry an ambiguous network create', async () => {
    createConversationInvokeMock.mockRejectedValue(new TypeError('connection lost'));
    const deps = customerDeps();
    const { result } = renderHook(() => useGuidSend(deps));
    act(() => result.current.sendMessageHandler());
    await waitFor(() => expect(deps.setLoading).toHaveBeenLastCalledWith(false));
    expect(createConversationInvokeMock).toHaveBeenCalledOnce();
    expect(deps.setInput).not.toHaveBeenCalled();
    expect(deps.navigate).not.toHaveBeenCalled();
  });

  it('keeps a named-skill draft when its startup catalog is unavailable', async () => {
    const deps = customerDeps();
    deps.input = '$report summarize';
    const { result } = renderHook(() => useGuidSend(deps));
    act(() => result.current.sendMessageHandler());
    await waitFor(() => expect(deps.setLoading).toHaveBeenLastCalledWith(false));
    expect(createConversationInvokeMock).not.toHaveBeenCalled();
    expect(deps.setInput).not.toHaveBeenCalled();
  });

  it('clears only the accepted draft and preserves text/files edited while provisioning', async () => {
    const creation = deferredCreation();
    createConversationInvokeMock.mockReturnValue(creation.promise);
    const deps = customerDeps();
    const { result } = renderHook(() => useGuidSend(deps));
    act(() => result.current.sendMessageHandler());
    await act(async () => creation.resolve({ id: 'conv-1' }));
    await waitFor(() => expect(deps.setInput).toHaveBeenCalledOnce());
    const updateInput = vi.mocked(deps.setInput).mock.calls[0][0] as (value: string) => string;
    expect(updateInput('hello')).toBe('');
    expect(updateInput('next prompt')).toBe('next prompt');
    const updateFiles = vi.mocked(deps.setFiles).mock.calls[0][0] as (
      value: GuidSendDeps['files']
    ) => GuidSendDeps['files'];
    const newFiles = [{ kind: 'upload' as const, path: 'new-upload' }];
    expect(updateFiles(newFiles)).toBe(newFiles);
  });

  it.each(['account change', 'unmount'])('does not stage or navigate after %s during creation', async (reason) => {
    const creation = deferredCreation();
    createConversationInvokeMock.mockReturnValue(creation.promise);
    const deps = customerDeps();
    const { result, rerender, unmount } = renderHook(() => useGuidSend(deps));
    let pending!: Promise<boolean>;
    act(() => {
      pending = result.current.handleSend();
    });
    if (reason === 'account change') {
      deps.customerAccountId = 'bob';
      rerender();
    } else unmount();
    await act(async () => {
      creation.resolve({ id: 'conv-1' });
      expect(await pending).toBe(false);
    });
    expect(deps.navigate).not.toHaveBeenCalled();
    expect(getQueue(queueScope('alice', 'conv-1')).items).toHaveLength(0);
    expect(getQueue(queueScope('bob', 'conv-1')).items).toHaveLength(0);
  });
  it('rejects an unknown named skill before creating a conversation and keeps the draft', async () => {
    const deps = createDeps();
    deps.selectedAssistantBackend = 'aionrs';
    deps.current_model = { id: 'test', use_model: 'mock-local' } as NonNullable<GuidSendDeps['current_model']>;
    deps.input = '$reports create an overview';
    deps.availableSkills = [{ name: 'report' }];
    const { result } = renderHook(() => useGuidSend(deps));
    await expect(result.current.handleSend()).rejects.toThrow('conversation.skills.unknownReference');
    expect(createConversationInvokeMock).not.toHaveBeenCalled();
    expect(deps.setInput).not.toHaveBeenCalled();
  });
  it('rejects an oversized managed prompt at every submission edge without creating a conversation or clearing input', async () => {
    const deps = createDeps();
    deps.selectedAssistantBackend = 'aionrs';
    deps.current_model = { id: 'managed', use_model: 'z-ai/glm-5.3' } as NonNullable<GuidSendDeps['current_model']>;
    deps.input = '한'.repeat(100_000);
    const { result } = renderHook(() => useGuidSend(deps));
    expect(result.current.isButtonDisabled).toBe(true);
    act(() => result.current.sendMessageHandler());
    await expect(result.current.handleSend()).rejects.toThrow('conversation.promptTooLarge');
    expect(createConversationInvokeMock).not.toHaveBeenCalled();
    expect(deps.setInput).not.toHaveBeenCalled();
  });
  it.each(['aionrs', 'claude'])(
    'adds widget engineering instructions to a plain feature request through %s without changing its title',
    async (backend) => {
      const deps = createDeps();
      deps.shopWidgetSelected = true;
      deps.selectedAssistantBackend = backend;
      deps.input = '상품 상세 페이지에 배송·반품 FAQ 위젯 만들어줘';
      deps.current_model = { id: 'test-provider', use_model: 'test-model' } as NonNullable<
        GuidSendDeps['current_model']
      >;
      createConversationInvokeMock.mockResolvedValue({ id: 'widget-handoff' });
      const { result } = renderHook(() => useGuidSend(deps));

      await act(async () => {
        await result.current.handleSend();
      });

      expect(createConversationInvokeMock.mock.calls[0][0].name).toBe(deps.input);
      expect(createConversationInvokeMock.mock.calls[0][0].extra.outputType).toBe('widget');
      const prefix = backend === 'aionrs' ? 'aionrs' : 'acp';
      const message = JSON.parse(sessionStorage.getItem(`${prefix}_initial_message_widget-handoff`)!);
      expect(message.input).toContain('installation code');
      expect(message.input).toContain('Shadow DOM');
      expect(message.input).toContain('Choose implementation details yourself');
      expect(message.input).toContain('Do not invent a deployment URL');
      expect(message.input).toMatch(new RegExp(`${deps.input}$`));
    }
  );

  it.each(['aionrs', 'claude'])('keeps ordinary %s requests free of widget instructions', async (backend) => {
    const deps = createDeps();
    deps.selectedAssistantBackend = backend;
    deps.current_model = { id: 'test-provider', use_model: 'test-model' } as NonNullable<GuidSendDeps['current_model']>;
    createConversationInvokeMock.mockResolvedValue({ id: 'ordinary-handoff' });
    const { result } = renderHook(() => useGuidSend(deps));
    await act(async () => {
      await result.current.handleSend();
    });
    const prefix = backend === 'aionrs' ? 'aionrs' : 'acp';
    const message = JSON.parse(sessionStorage.getItem(`${prefix}_initial_message_ordinary-handoff`)!);
    expect(message.input).toBe(deps.input);
    expect(createConversationInvokeMock.mock.calls[0][0].extra.outputType).toBeUndefined();
  });

  it('waits for a widget description while retaining ordinary empty-chat behavior', async () => {
    const deps = createDeps();
    deps.input = '  ';
    deps.shopWidgetSelected = true;
    const { result, rerender } = renderHook(() => useGuidSend(deps));
    expect(result.current.isButtonDisabled).toBe(true);
    await act(async () => {
      await result.current.handleSend();
    });
    expect(createConversationInvokeMock).not.toHaveBeenCalled();

    deps.shopWidgetSelected = false;
    rerender();
    expect(result.current.isButtonDisabled).toBe(false);
  });

  beforeEach(() => {
    sessionStorage.clear();
    resetCustomerPromptQueuesForTest();
    createConversationInvokeMock.mockReset();
    createConversationInvokeMock.mockResolvedValue({ id: 'conv-1' });
    swrMutateMock.mockReset();
    swrMutateMock.mockResolvedValue(undefined);
  });

  it('passes selected mode into assistant conversation overrides when creating a preset ACP conversation', async () => {
    const deps = createDeps();
    deps.selectedThoughtLevelValue = 'high';

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    expect(createConversationInvokeMock).toHaveBeenCalledTimes(1);
    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.type).toBeUndefined();
    expect('model' in payload).toBe(false);
    expect(payload.assistant?.conversation_overrides?.permission).toBe('bypassPermissions');
    expect(payload.assistant?.conversation_overrides?.model).toBe('claude-opus');
    expect(payload.assistant?.conversation_overrides?.thought_level).toBe('high');
    expect(payload.extra.backend).toBeUndefined();
    expect(payload.extra.agent_name).toBeUndefined();
    expect(payload.extra.agent_id).toBeUndefined();
    expect(payload.extra.custom_agent_id).toBeUndefined();
    expect(payload.extra.preset_rules).toBeUndefined();
    expect(payload.extra.preset_context).toBeUndefined();
    expect(payload.extra.session_mode).toBeUndefined();
    expect(payload.extra.current_model_id).toBeUndefined();
    expect(payload.extra.preset_assistant_id).toBeUndefined();
    expect(swrMutateMock).toHaveBeenCalledWith('guid.assistant.detail.assistant-1.zh-CN');
    expect(swrMutateMock).toHaveBeenCalledWith('assistants.list');
  });

  it('falls back to assistant default skill and MCP ids for preset conversations before local Guid overrides exist', async () => {
    const deps = createDeps();
    deps.guidEnabledSkills = undefined;
    deps.guidDisabledBuiltinSkills = undefined;
    deps.assistantDefaultSkillIds = ['assistant-skill'];
    deps.assistantDefaultDisabledBuiltinSkillIds = ['builtin-skill'];
    deps.selectedMcpServerIds = undefined;
    deps.assistantDefaultMcpIds = ['mcp-user'];

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant?.conversation_overrides?.skill_ids).toEqual(['assistant-skill']);
    expect(payload.assistant?.conversation_overrides?.disabled_builtin_skill_ids).toEqual(['builtin-skill']);
    expect(payload.assistant?.conversation_overrides?.mcp_ids).toEqual(['mcp-user']);
    expect(payload.extra.selected_mcp_server_ids).toEqual(['mcp-user']);
  });

  it('preserves builtin MCP ids in assistant overrides while only sending user MCP ids to runtime selection', async () => {
    const deps = createDeps();
    deps.availableMcpServers = [
      { id: 'mcp-user', name: 'User MCP', enabled: true, builtin: false } as IMcpServer,
      { id: 'builtin-mcp', name: 'Builtin MCP', enabled: true, builtin: true } as IMcpServer,
    ];
    deps.selectedMcpServerIds = ['mcp-user', 'builtin-mcp'];

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant?.conversation_overrides?.mcp_ids).toEqual(['mcp-user', 'builtin-mcp']);
    expect(payload.extra.selected_mcp_server_ids).toEqual(['mcp-user']);
    expect(payload.extra.selected_session_mcp_servers).toEqual([expect.objectContaining({ id: 'builtin-mcp' })]);
  });

  it('does not write legacy preset_assistant_id for preset assistant sends', async () => {
    const deps = createDeps();

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant?.id).toBe('assistant-1');
    expect(payload.extra.preset_assistant_id).toBeUndefined();
  });

  it('forwards local skill overrides through assistant conversation overrides for ACP assistants', async () => {
    const deps = createDeps();
    deps.guidEnabledSkills = ['pdf-reader'];
    deps.guidDisabledBuiltinSkills = ['todo-tracker'];

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant?.id).toBe('assistant-1');
    expect(payload.assistant?.conversation_overrides?.skill_ids).toEqual(['pdf-reader']);
    expect(payload.assistant?.conversation_overrides?.disabled_builtin_skill_ids).toEqual(['todo-tracker']);
  });

  it('forwards local skill overrides for generated Aion CLI assistants through assistant conversation overrides', async () => {
    const deps = createDeps();
    deps.selectedAssistantId = 'bare:aionrs';
    deps.selectedAssistantBackend = 'aionrs';
    deps.current_model = { provider_id: 'openai', model: 'gemini-2.5-pro', use_model: 'gemini-2.5-pro' } as never;
    deps.guidEnabledSkills = ['pdf-reader'];
    deps.guidDisabledBuiltinSkills = ['todo-tracker'];

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.type).toBeUndefined();
    expect(payload.model).toBe(deps.current_model);
    expect(payload.assistant?.id).toBe('bare:aionrs');
    expect(payload.assistant?.conversation_overrides?.skill_ids).toEqual(['pdf-reader']);
    expect(payload.assistant?.conversation_overrides?.disabled_builtin_skill_ids).toEqual(['todo-tracker']);
    expect(payload.extra.session_mode).toBeUndefined();
  });

  it('does not write legacy preset_assistant_id for generated Aion CLI assistant conversations', async () => {
    const deps = createDeps();
    deps.selectedAssistantId = 'bare:aionrs';
    deps.selectedAssistantBackend = 'aionrs';
    deps.current_model = { provider_id: 'openai', model: 'gemini-2.5-pro', use_model: 'gemini-2.5-pro' } as never;

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant?.id).toBe('bare:aionrs');
    expect(payload.extra.preset_assistant_id).toBeUndefined();
  });

  it('does not write legacy preset_assistant_id for generated ACP assistant conversations', async () => {
    const deps = createDeps();
    deps.selectedAssistantId = 'bare:claude';
    deps.selectedAssistantBackend = 'claude';
    deps.current_model = { provider_id: 'anthropic', model: 'claude-sonnet', use_model: 'claude-sonnet' } as never;

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant?.id).toBe('bare:claude');
    expect(payload.type).toBeUndefined();
    expect('model' in payload).toBe(false);
    expect(payload.extra.preset_assistant_id).toBeUndefined();
    expect(payload.extra.backend).toBeUndefined();
  });

  it('does not hand a CLI agent the aionrs provider model on its first turn', async () => {
    // Reproduces the first-use failure: before the agent's catalog has been
    // probed there is no ACP model to offer, and the provider selection used to
    // fill the gap. A brand new Antigravity conversation therefore started on
    // `gemini-3.1-pro-preview` — a model agy has never heard of — and the turn
    // died with USER_LLM_PROVIDER_MODEL_NOT_FOUND. Once the catalog landed the
    // earlier option won again, which is why it only ever showed up on a fresh
    // machine.
    const deps = createDeps();
    deps.selectedAssistantBackend = 'antigravity';
    deps.selectedAcpModel = null;
    deps.current_model = { id: 'p1', name: 'Gemini', use_model: 'gemini-3.1-pro-preview' } as never;

    const { result } = renderHook(() => useGuidSend(deps));
    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    // No model at all: the agent then starts on its own default, which is what
    // "the user has not picked one" actually means.
    expect(payload.assistant.conversation_overrides.model).toBeUndefined();
  });

  it('still gives aionrs its provider model', async () => {
    // The fallback exists for aionrs, whose model IS the provider selection.
    const deps = createDeps();
    deps.selectedAssistantBackend = 'aionrs';
    deps.selectedAcpModel = null;
    deps.current_model = { id: 'p1', name: 'Gemini', use_model: 'gemini-3.1-pro-preview' } as never;

    const { result } = renderHook(() => useGuidSend(deps));
    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant.conversation_overrides.model).toBe('gemini-3.1-pro-preview');
  });

  it('sends no model override for a CLI agent when the user has not picked one', async () => {
    // The agent's own catalog is NOT a stand-in for the user's intent. It used to be
    // substituted here, so an unpicked conversation inherited whatever the agent's LAST
    // session had written back — for claude usually its `default` row, which pins the
    // account default and overrides the user's own ANTHROPIC_MODEL. Omitting the override
    // is what lets the agent resolve the model from the user's config, exactly as its CLI
    // does; the aionrs provider model stays gated to aionrs.
    const deps = createDeps();
    deps.selectedAssistantBackend = 'antigravity';
    deps.selectedAcpModel = null;
    deps.current_model = { id: 'p1', name: 'Gemini', use_model: 'gemini-3.1-pro-preview' } as never;

    const { result } = renderHook(() => useGuidSend(deps));
    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant.conversation_overrides.model).toBeUndefined();
  });

  it('sends the model the user actually picked for a CLI agent', async () => {
    const deps = createDeps();
    deps.selectedAssistantBackend = 'claude';
    deps.selectedAcpModel = 'default';
    deps.current_model = { id: 'p1', name: 'Gemini', use_model: 'gemini-3.1-pro-preview' } as never;

    const { result } = renderHook(() => useGuidSend(deps));
    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    // `default` is a real row of claude's catalog, not a synonym for "unpicked": it must
    // travel so the agent runs the account default the row advertises.
    expect(payload.assistant.conversation_overrides.model).toBe('default');
  });

  it('does not create a conversation without assistant identity', async () => {
    const deps = createDeps();
    deps.selectedAssistantId = null;
    deps.selectedAssistantBackend = 'claude';

    const { result } = renderHook(() => useGuidSend(deps));

    expect(result.current.isButtonDisabled).toBe(true);

    await act(async () => {
      await result.current.handleSend();
    });

    expect(createConversationInvokeMock).not.toHaveBeenCalled();
  });

  it('allows an empty-input start: creates the conversation but stashes no initial ACP message', async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const deps = createDeps();
    deps.input = '   '; // whitespace only counts as empty

    const { result } = renderHook(() => useGuidSend(deps));

    // Empty input is no longer gated once an assistant is selected.
    expect(result.current.isButtonDisabled).toBe(false);

    await act(async () => {
      await result.current.handleSend();
    });

    expect(createConversationInvokeMock).toHaveBeenCalledTimes(1);
    expect(deps.navigate).toHaveBeenCalledWith('/conversation/conv-1');
    // No initial message is queued, so the window opens idle on the empty state.
    expect(setItemSpy).not.toHaveBeenCalledWith('acp_initial_message_conv-1', expect.anything());
    setItemSpy.mockRestore();
  });

  it('allows an empty-input start for aionrs without stashing an initial message', async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const deps = createDeps();
    deps.input = '';
    deps.selectedAssistantBackend = 'aionrs';
    deps.current_model = { provider_id: 'openai', model: 'gemini-2.5-pro', use_model: 'gemini-2.5-pro' } as never;

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    expect(createConversationInvokeMock).toHaveBeenCalledTimes(1);
    expect(deps.navigate).toHaveBeenCalledWith('/conversation/conv-1');
    expect(setItemSpy).not.toHaveBeenCalledWith('aionrs_initial_message_conv-1', expect.anything());
    setItemSpy.mockRestore();
  });
});

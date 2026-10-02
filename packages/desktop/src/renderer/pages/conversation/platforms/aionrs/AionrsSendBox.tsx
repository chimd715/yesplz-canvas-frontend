/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { getPromptBudget } from '@/common/utils/modelCapabilities';
import { parseExplicitSkillNames, unknownExplicitSkills } from '@/common/chat/slash/explicitSkills';
import type { IConversationMcpStatus } from '@/common/config/storage';
import AionrsModelSelector from './AionrsModelSelector';
import AgentModeSelector from '@/renderer/components/agent/AgentModeSelector';
import CommandQueuePanel from '@/renderer/components/chat/CommandQueuePanel';
import MobileActionSheet, {
  type MobileActionSheetEntry,
  type MobileActionSheetOption,
  useAttachEntry,
} from '@/renderer/components/chat/MobileActionSheet';
import SendBox from '@/renderer/components/chat/SendBox';
import ThoughtDisplay from '@/renderer/components/chat/ThoughtDisplay';
import FileAttachButton from '@/renderer/components/media/FileAttachButton';
import FilePreview from '@/renderer/components/media/FilePreview';
import HorizontalFileList from '@/renderer/components/media/HorizontalFileList';
import { classifyConfigSetError, useAcpConfigOptions } from '@/renderer/hooks/agent/useAcpConfigOptions';
import { useConversationContextSafe } from '@/renderer/hooks/context/ConversationContext';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import { useAutoTitle } from '@/renderer/hooks/chat/useAutoTitle';
import { getSendBoxDraftHook, type FileOrFolderItem } from '@/renderer/hooks/chat/useSendBoxDraft';
import { createSetUploadFile, useSendBoxFiles } from '@/renderer/hooks/chat/useSendBoxFiles';
import { useSlashCommands } from '@/renderer/hooks/chat/useSlashCommands';
import { useOpenFileSelector } from '@/renderer/hooks/file/useOpenFileSelector';
import { useLatestRef } from '@/renderer/hooks/ui/useLatestRef';
import {
  useConversationCommandQueue,
  type ConversationCommandQueueItem,
} from '@/renderer/pages/conversation/platforms/useConversationCommandQueue';
import { useConversationRuntimeView } from '@/renderer/pages/conversation/runtime/useConversationRuntimeView';
import { useMessageList, useMessagePaginationState } from '@/renderer/pages/conversation/Messages/hooks';
import {
  hasCurrentTurnActivity,
  useActivityTurnGate,
} from '@/renderer/pages/conversation/Messages/components/TurnActivity';
import { useConversationEntryRuntime } from '@/renderer/pages/conversation/runtime/useConversationEntryRuntime';
import { getConversationRuntimeWorkspaceErrorMessage } from '@/renderer/pages/conversation/utils/conversationCreateError';
import { getChatSurfaceWidthClass } from '@/renderer/pages/conversation/utils/chatSurfaceWidth';
import { ensureConversationRuntime } from '@/renderer/pages/conversation/utils/ensureConversationRuntime';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview';
import { useTeamPermission } from '@/renderer/pages/team/hooks/TeamPermissionContext';
import type { TeamSendBoxRuntime } from '@/renderer/pages/team/components/teamSendRuntime';
import { allSupportedExts } from '@/renderer/services/FileService';
import { iconColors } from '@/renderer/styles/colors';
import type { SessionRef } from '@/common/adapter/ipcBridge';
import CrossSessionDisabledBanner from '@/renderer/components/chat/CrossSessionDisabledBanner';
import { useCrossSessionMessageEnabled } from '@/renderer/hooks/chat/useCrossSessionMessageEnabled';
import { emitter, useAddEventListener } from '@/renderer/utils/emitter';
import { type ChatFileRef, isChatFileRef, uploadFileRef } from '@/common/types/chatFile';
import { localSelectionItems, mergeFileSelectionItems } from '@/renderer/utils/file/fileSelection';
import { collectChatFileRefs, splitChatFileRefs } from '@/renderer/utils/file/messageFiles';
import type { AgentModeOption } from '@/renderer/utils/model/agentTypes';
import { Button, Message, Tag } from '@arco-design/web-react';
import { Brain, Lightning, MagicHat, Shield } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { classifyConversationBusyError } from '../conversationBusyError';
import { useAionrsMessage } from './useAionrsMessage';
import type { AionrsModelSelection } from './useAionrsModelSelection';
import { PromptQueuePanel, PromptQueueAdmissionError, useCustomerPromptQueue } from './PromptQueue';

const configErrorMessageKey = (error: unknown) => {
  const errorKind = classifyConfigSetError(error);
  if (errorKind === 'command_ack') return 'agent.config.commandAck';
  if (errorKind === 'confirmation_timeout') return 'agent.config.timeout';
  if (errorKind === 'config_update_in_progress') return 'agent.config.busy';
  return 'agent.config.failed';
};

const toModeLabel = (value: string): string =>
  value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

const modeOptionsFromCapabilities = (modes: string[]): AgentModeOption[] =>
  modes.map((value) => ({ value, label: toModeLabel(value) }));

const useAionrsSendBoxDraft = getSendBoxDraftHook('aionrs', {
  _type: 'aionrs',
  atPath: [],
  content: '',
  uploadFile: [],
});

const EMPTY_AT_PATH: Array<string | FileOrFolderItem> = [];
const EMPTY_UPLOAD_FILES: string[] = [];

const useSendBoxDraft = (conversation_id: string) => {
  const { data, mutate } = useAionrsSendBoxDraft(conversation_id);

  const atPath = data?.atPath ?? EMPTY_AT_PATH;
  const uploadFile = data?.uploadFile ?? EMPTY_UPLOAD_FILES;
  const content = data?.content ?? '';

  const setAtPath = useCallback(
    (nextAtPath: Array<string | FileOrFolderItem>) => {
      mutate((prev) => ({ ...prev, atPath: nextAtPath }));
    },
    [data, mutate]
  );

  const setUploadFile = createSetUploadFile(mutate, data);

  const setContent = useCallback(
    (nextContent: string) => {
      mutate((prev) => ({ ...prev, content: nextContent }));
    },
    [data, mutate]
  );

  return {
    atPath,
    uploadFile,
    setAtPath,
    setUploadFile,
    content,
    setContent,
  };
};

const AionrsSendBox: React.FC<{
  conversation_id: string;
  modelSelection: AionrsModelSelection;
  session_mode?: string;
  agent_name?: string;
  teamSendMessage?: (payload: { input: string; files: ChatFileRef[] }) => Promise<void>;
  teamRuntime?: TeamSendBoxRuntime;
}> = ({ conversation_id, modelSelection, session_mode, agent_name, teamSendMessage, teamRuntime }) => {
  const [dynamicModes, setDynamicModes] = useState<AgentModeOption[]>([]);
  const [currentMode, setCurrentMode] = useState<string | undefined>(session_mode);
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false);
  const layout = useLayoutContext();
  const isMobile = Boolean(layout?.isMobile);
  const auth = useAuth();
  // Team API owns its own slot queue and accepts mid-turn messages separately.
  const teamPermission = useTeamPermission();
  const isCustomerChat = !window.electronAPI && !teamSendMessage && !teamRuntime && !teamPermission?.isTeamMode;
  const activityMessages = useMessageList();
  const activityPagination = useMessagePaginationState();
  const { data: explicitSkills } = useSWR(
    auth.status === 'authenticated' && auth.user?.id ? ['customer.skills', auth.user.id] : null,
    () => ipcBridge.fs.listAvailableSkills.invoke()
  );
  const explicitSkillsRef = useLatestRef(explicitSkills);
  const conversationContext = useConversationContextSafe();
  const loadedSkills = conversationContext?.loadedSkills ?? [];
  const loadedMcpStatuses =
    conversationContext?.loadedMcpStatuses ??
    (conversationContext?.loadedMcpServers ?? []).map<IConversationMcpStatus>((name) => ({
      id: name,
      name,
      status: 'loaded',
    }));
  const { t } = useTranslation();
  const { checkAndUpdateTitle } = useAutoTitle();
  const { current_model } = modelSelection;
  const propagateMode = teamPermission?.propagateMode;

  const { thought, running, turnStartedAtMs, tokenUsage, setActiveMsgId, setWaitingResponse, resetState } =
    useAionrsMessage(conversation_id, {
      onConfigChanged: (capabilities) => {
        const modes = (capabilities as { modes?: string[] })?.modes;
        if (modes && modes.length > 0) {
          setDynamicModes(modeOptionsFromCapabilities(modes));
        }
      },
    });
  const runtimeView = useConversationRuntimeView(conversation_id);
  const activityIsProcessing = useActivityTurnGate(
    conversation_id,
    activityMessages,
    {
      isProcessing: runtimeView.isProcessing,
      activeTurnId: runtimeView.activeTurnId,
      localSubmitting: runtimeView.view?.localSubmitting,
      hydrated: runtimeView.hydrated,
    },
    !activityPagination.hasMoreAfter
  );
  const hasInlineActivity = useMemo(
    () => isCustomerChat && activityIsProcessing && hasCurrentTurnActivity(activityMessages),
    [isCustomerChat, activityIsProcessing, activityMessages]
  );
  const { markSendStarted, markSendAccepted, markSendFailed } = runtimeView;

  const { atPath, uploadFile, setAtPath, setUploadFile, content, setContent } = useSendBoxDraft(conversation_id);
  const priorContextTokens = tokenUsage?.total_tokens ?? 0;
  const promptBudget = getPromptBudget(content, current_model, uploadFile.length + atPath.length, priorContextTokens);
  const promptBudgetOptionsRef = useLatestRef({ model: current_model, priorContextTokens });
  const validatePrompt = useCallback(
    (input: string, attachmentCount: number) => {
      const options = promptBudgetOptionsRef.current;
      const budget = getPromptBudget(input, options.model, attachmentCount, options.priorContextTokens);
      if (!budget.allowed) {
        Message.error(t('conversation.promptTooLarge', { limit: budget.maxBytes }));
        return false;
      }
      const unknown = unknownExplicitSkills(input, explicitSkillsRef.current);
      if (unknown.length) {
        Message.error(
          t(
            explicitSkillsRef.current
              ? 'conversation.skills.unknownReference'
              : 'conversation.skills.catalogUnavailable',
            { names: unknown.join(', ') }
          )
        );
        return false;
      }
      return true;
    },
    [t]
  );

  const handleContentChange = useCallback(
    (val: string) => {
      setContent(val);
    },
    [setContent]
  );

  const prepareRuntimeConfig = useCallback(async () => {
    if (teamPermission) return;
  }, [teamPermission]);
  const prepareRuntimeSync = useCallback(async () => {
    if (teamPermission) {
      await teamPermission.warmupSession();
      return;
    }
    await ensureConversationRuntime(conversation_id);
  }, [conversation_id, teamPermission]);
  const entryRuntime = useConversationEntryRuntime(conversation_id, prepareRuntimeSync);
  const entryReadyRef = useLatestRef(entryRuntime.isReady);
  const runtimeConfig = useAcpConfigOptions({
    conversation_id,
    prepareRuntime: prepareRuntimeConfig,
    prepareSetRuntime: teamPermission?.warmupSession,
    configOptionsPort: teamPermission?.configOptionsPort,
    enabled: Boolean(conversation_id),
  });
  const runtimeMode = runtimeConfig.mode;
  const runtimeThoughtLevel = runtimeConfig.thoughtLevel;

  useEffect(() => {
    if (!runtimeMode?.currentValue) return;
    setCurrentMode(runtimeMode.currentValue);
  }, [runtimeMode?.currentValue]);

  const slash_commands = useSlashCommands(conversation_id, {
    conversation_type: 'aionrs',
    agentStatus: entryRuntime.isReady ? 'active' : null,
    prepareRuntime: teamPermission ? prepareRuntimeSync : undefined,
  });

  const { setSendBoxHandler } = usePreviewContext();
  const commandQueueRuntimeGate = teamRuntime?.runtimeGate ?? {
    hydrated: runtimeView.hydrated && entryRuntime.isReady,
    canSendMessage: runtimeView.canSendMessage && entryRuntime.isReady && !modelSelection.isChanging,
    isProcessing: runtimeView.isProcessing || Boolean(modelSelection.isChanging),
  };
  const isCancelling = runtimeView.state === 'cancelling';
  const isBusy = isCancelling || commandQueueRuntimeGate.isProcessing || !commandQueueRuntimeGate.canSendMessage;

  const setContentRef = useLatestRef(setContent);
  const contentRef = useLatestRef(content);
  const atPathRef = useLatestRef(atPath);

  // Register handler for adding text from preview panel to sendbox
  useEffect(() => {
    const handler = (text: string) => {
      const new_content = content ? `${content}\n${text}` : text;
      setContentRef.current(new_content);
    };
    setSendBoxHandler(handler);
  }, [setSendBoxHandler, content]);

  // Listen for sendbox.fill event to append text to sendbox
  useAddEventListener(
    'sendbox.fill',
    (text: string) => {
      const prev = contentRef.current;
      setContentRef.current(prev ? `${prev}${text}` : text);
    },
    []
  );

  // Shared file handling logic
  const { handleFilesAdded, clearFiles } = useSendBoxFiles({
    atPath,
    uploadFile,
    setAtPath,
    setUploadFile,
  });

  const executeCommand = useCallback(
    async ({ input, files, sessions }: Pick<ConversationCommandQueueItem, 'input' | 'files' | 'sessions'>) => {
      if (!entryReadyRef.current) throw new PromptQueueAdmissionError('Conversation runtime is not ready');
      if (!validatePrompt(input, files.length))
        throw new PromptQueueAdmissionError('Prompt exceeds the selected model budget');
      if (teamPermission) await teamPermission.warmupSession();
      if (!current_model?.use_model) {
        Message.warning(t('conversation.chat.noModelSelected'));
        throw new PromptQueueAdmissionError('No model selected');
      }

      // The message body is plain user text; the backend resolves each
      // ChatFileRef to an absolute path and injects the [[AION_FILES]] marker at
      // the send edge — the front-end no longer builds paths nor the marker.
      try {
        void checkAndUpdateTitle(conversation_id, input);
        if (teamSendMessage) {
          await teamSendMessage({ input, files });
          emitter.emit('chat.history.refresh');
          if (files.length > 0) {
            emitter.emit('aionrs.workspace.refresh');
          }
          return undefined;
        }

        markSendStarted();
        setWaitingResponse(true);
        const res = await ipcBridge.conversation.sendMessage.invoke({
          input,
          conversation_id,
          files,
          // `@@` references. Omitting this makes the whole feature silently
          // no-op for this platform.
          sessions,
          inject_skills: parseExplicitSkillNames(input),
        });
        setActiveMsgId(res.msg_id);
        markSendAccepted(res.turn_id, res.runtime, res.msg_id);
        emitter.emit('chat.history.refresh');
        if (files.length > 0) {
          emitter.emit('aionrs.workspace.refresh');
        }
        return { turnId: res.turn_id, isProcessing: res.runtime.is_processing };
      } catch (error) {
        const errorMessage =
          getConversationRuntimeWorkspaceErrorMessage(error, t) ||
          (error instanceof Error ? error.message : String(error));
        const busyError = classifyConversationBusyError(error);
        if (busyError) {
          markSendFailed({
            kind: 'busy_conflict',
            reason: errorMessage,
            busyKind: busyError.kind,
            status: busyError.status,
            code: busyError.code,
          });
          throw error;
        }

        markSendFailed({ kind: 'ordinary', reason: errorMessage });
        Message.error(errorMessage);
        throw error;
      }
    },
    [
      checkAndUpdateTitle,
      conversation_id,
      current_model?.use_model,
      markSendAccepted,
      markSendFailed,
      markSendStarted,
      setActiveMsgId,
      setWaitingResponse,
      t,
      teamPermission,
      teamSendMessage,
      validatePrompt,
    ]
  );

  const {
    items: queuedCommands,
    mode: queueMode,
    isInteractionLocked: isQueueInteractionLocked,
    enqueue,
    remove,
    prioritize,
    clear,
    reorder,
    toggleMode,
    lockInteraction,
    unlockInteraction,
    resetActiveExecution,
  } = useConversationCommandQueue({
    conversation_id: conversation_id,
    enabled: !isCustomerChat,
    isBusy,
    runtimeGate: commandQueueRuntimeGate,
    onExecute: async (item) => {
      await executeCommand(item);
    },
  });
  const customerQueue = useCustomerPromptQueue({
    accountId: auth.status === 'authenticated' ? auth.user?.id : undefined,
    conversationId: conversation_id,
    enabled: isCustomerChat,
    runtimeGate: commandQueueRuntimeGate,
    validate: validatePrompt,
    onExecute: executeCommand,
  });
  useAddEventListener(
    'conversation.deleted',
    (id) => {
      if (isCustomerChat && id === conversation_id) customerQueue.clear();
    },
    [conversation_id, isCustomerChat, customerQueue.clear]
  );

  // Handle initial message from Guid page — wait until model is ready
  useEffect(() => {
    if (!conversation_id || !current_model?.use_model || !entryRuntime.isReady) return;

    const storageKey = `aionrs_initial_message_${conversation_id}`;
    const processedKey = `aionrs_initial_processed_${conversation_id}`;

    const processInitialMessage = async () => {
      if (sessionStorage.getItem(processedKey)) return;
      const storedMessage = sessionStorage.getItem(storageKey);
      if (!storedMessage) return;

      sessionStorage.setItem(processedKey, '1');
      sessionStorage.removeItem(storageKey);

      try {
        const { input, files: initialFiles } = JSON.parse(storedMessage);
        // Guid-page initial files are source-tagged ChatFileRefs (`local` for
        // backend-machine picks, `upload` for device uploads). Legacy string[]
        // entries (a stale pre-upgrade session) coerce to upload refs.
        const initialRefs: ChatFileRef[] = Array.isArray(initialFiles)
          ? initialFiles.map((f: unknown) => (typeof f === 'string' ? uploadFileRef(f) : f)).filter(isChatFileRef)
          : [];
        await executeCommand({ input, files: initialRefs });
      } catch (error) {
        console.error('[AionrsSendBox] Failed to send initial message:', error);
        sessionStorage.removeItem(processedKey);
      }
    };

    void processInitialMessage();
  }, [conversation_id, current_model?.use_model, entryRuntime.isReady, executeCommand]);

  // `@@` session references the user picked. Declared before the handlers that
  // read it — every send path has to both forward and release it.
  const [selectedSessions, setSelectedSessions] = useState<SessionRef[]>([]);
  const { enabled: crossSessionEnabled } = useCrossSessionMessageEnabled();

  // Browser submissions enter the scoped FIFO; the active turn is never interrupted.
  const directSendInFlight = useRef(false);
  const onSendHandler = async (message: string): Promise<void | false> => {
    if (!validatePrompt(message, uploadFile.length + atPath.length)) return false;
    if (!entryReadyRef.current) {
      Message.warning(t(`conversation.entryRuntime.${entryRuntime.phase === 'failed' ? 'failed' : 'preparing'}`));
      return false;
    }
    if (directSendInFlight.current) return false;
    if (isCustomerChat) {
      directSendInFlight.current = true;
      try {
        const accepted = customerQueue.enqueue({
          input: message,
          files: collectChatFileRefs(uploadFile, atPath),
          sessions: selectedSessions.length ? selectedSessions : undefined,
        });
        if (!accepted) return false;
        clearFiles();
        setSelectedSessions([]);
        emitter.emit('aionrs.selected.file.clear');
        return;
      } finally {
        // Block repeated Enter from the same committed draft in this event tick.
        queueMicrotask(() => {
          directSendInFlight.current = false;
        });
      }
    }
    if (isBusy) {
      Message.warning(
        t('conversation.commandQueue.midturnBlocked', {
          defaultValue:
            'This agent is still working, so the message can’t be sent directly. Save it to Draft box and send it later.',
        })
      );
      return false;
    }

    directSendInFlight.current = true;
    try {
      const filesToSend = collectChatFileRefs(uploadFile, atPath);
      const sessions = selectedSessions.length > 0 ? selectedSessions : undefined;
      clearFiles();
      setSelectedSessions([]);
      emitter.emit('aionrs.selected.file.clear');
      await executeCommand({ input: message, files: filesToSend, sessions });
    } finally {
      directSendInFlight.current = false;
    }
  };

  const [interrupting, setInterrupting] = useState(false);
  const handleInterruptSend = async () => {
    if (!teamRuntime?.onInterruptSend || !content.trim() || interrupting) return;
    if (!validatePrompt(content, uploadFile.length + atPath.length)) return;
    const files = collectChatFileRefs(uploadFile, atPath);
    const input = content;
    setContent('');
    clearFiles();
    emitter.emit('aionrs.selected.file.clear');
    setInterrupting(true);
    try {
      await teamRuntime.onInterruptSend({ input, files });
    } finally {
      setInterrupting(false);
    }
  };

  // Explicit "add to queue" entry — visibility is keyed only to the user's
  // own input (non-empty draft), never to the agent's busy/replying state:
  // tying it to that racy, async signal made the entry appear/disappear
  // unpredictably. Clicking while idle is semantically fine — the queue's own
  // mode governs (auto drains immediately, manual holds). Clears the draft
  // the same way a send would.
  const canQueueCurrentDraft = content.trim().length > 0;
  const handleAddToQueue = useCallback(() => {
    if (isCustomerChat && directSendInFlight.current) return;
    if (!validatePrompt(content, uploadFile.length + atPath.length)) return;
    const filesToSend = collectChatFileRefs(uploadFile, atPath);
    // `@@` references must ride along, and must be released from the send box
    // the same way the draft text is — otherwise they leak into whatever the
    // user sends next.
    const accepted = (isCustomerChat ? customerQueue.enqueue : enqueue)({
      input: content,
      files: filesToSend,
      sessions: selectedSessions.length > 0 ? selectedSessions : undefined,
    });
    if (!accepted) return;
    if (isCustomerChat) {
      directSendInFlight.current = true;
      queueMicrotask(() => {
        directSendInFlight.current = false;
      });
    }
    setContent('');
    clearFiles();
    setSelectedSessions([]);
    emitter.emit('aionrs.selected.file.clear');
  }, [
    atPath,
    clearFiles,
    content,
    enqueue,
    selectedSessions,
    setContent,
    uploadFile,
    validatePrompt,
    isCustomerChat,
    customerQueue.enqueue,
  ]);

  const handleEditQueuedCommand = useCallback(
    (item: ConversationCommandQueueItem) => {
      if (isCustomerChat && (contentRef.current.trim() || uploadFile.length || atPathRef.current.length)) return;
      if (isCustomerChat) {
        if (!customerQueue.remove(item.id)) return;
      } else remove(item.id);
      setContent(item.input);
      // Restore the two selection lanes: upload refs → uploadFile paths,
      // project refs → atPath items carrying their chatRef (so a re-send
      // collects the same project ref).
      const { uploadFiles, atPath: restoredAtPath } = splitChatFileRefs(item.files);
      setUploadFile(uploadFiles);
      setAtPath(restoredAtPath);
      setSelectedSessions(item.sessions ?? []);
      emitter.emit('aionrs.selected.file.clear');
    },
    [remove, setAtPath, setContent, setUploadFile, isCustomerChat, customerQueue.remove, uploadFile.length]
  );

  const appendSelectedFiles = useCallback(
    (files: string[]) => {
      // "Add files" picks a file from the backend machine's own filesystem
      // (native dialog / server-fs browse) — an absolute backend path. Send it
      // as a `local` ref (via the atPath lane, external-owned), NOT an `upload`
      // ref: the raw path is not under the managed upload dir and would be
      // rejected. Merge into this box's atPath only (no cross-column emit).
      const merged = mergeFileSelectionItems(atPathRef.current, localSelectionItems(files));
      if (merged !== atPathRef.current) setAtPath(merged as Array<string | FileOrFolderItem>);
    },
    [setAtPath]
  );
  const { openFileSelector, onSlashBuiltinCommand } = useOpenFileSelector({
    onFilesSelected: appendSelectedFiles,
    onFilesUploaded: handleFilesAdded,
    conversation_id,
  });

  const { entries: attachEntries, hiddenFileInput: attachHiddenInput } = useAttachEntry({
    openFileSelector,
    onLocalFilesAdded: handleFilesAdded,
    dividerBefore: true,
  });

  const handleSheetModeChange = useCallback(
    async (mode: string) => {
      if (!runtimeMode || mode === runtimeMode.currentValue) return;
      try {
        await runtimeConfig.setConfigOption(runtimeMode.id, mode);
        setCurrentMode(mode);
        propagateMode?.(mode);
        Message.success(t('agentMode.switchSuccess'));
      } catch (error) {
        console.error('[AionrsSendBox] Failed to switch mode via sheet:', error);
        Message.error(t(configErrorMessageKey(error)));
      }
    },
    [propagateMode, runtimeConfig, runtimeMode, t]
  );

  const handleSheetModelSelect = useCallback(
    (value: string) => {
      if (
        runtimeConfig.isConfigOptionBlocked?.('model') ||
        modelSelection.isChanging ||
        (!window.electronAPI && isBusy)
      )
        return;
      // value format: `${providerId}::${modelName}`
      const [providerId, modelName] = value.split('::');
      const provider = modelSelection.providers.find((p) => p.id === providerId);
      if (!provider || !modelName) return;
      void modelSelection.handleSelectModel(provider, modelName);
    },
    [modelSelection, runtimeConfig, isBusy]
  );

  const sheetEntries = useMemo<MobileActionSheetEntry[]>(() => {
    if (!isMobile) return [];

    const availableModes: AgentModeOption[] =
      runtimeMode?.options.map((item) => ({
        value: item.value,
        label: item.label,
        description: item.description ?? undefined,
      })) ??
      (dynamicModes.length > 0
        ? dynamicModes
        : [
            { value: 'default', label: 'Default' },
            { value: 'auto_edit', label: 'Auto-Accept Edits' },
            { value: 'yolo', label: 'YOLO' },
          ]);
    const modeOptions: MobileActionSheetOption[] = availableModes.map((mode) => ({
      key: mode.value,
      label: t(`agentMode.${mode.value}`, { defaultValue: mode.label }),
      description: mode.description,
      active: (runtimeMode?.currentValue ?? currentMode) === mode.value,
    }));

    const modelOptions: MobileActionSheetOption[] = modelSelection.providers.flatMap((provider) =>
      modelSelection.getAvailableModels(provider).map((modelName) => ({
        key: `${provider.id}::${modelName}`,
        label: modelName,
        description: provider.name,
        active:
          modelSelection.current_model?.id === provider.id && modelSelection.current_model?.use_model === modelName,
      }))
    );

    const currentModeLabel =
      modeOptions.find((opt) => opt.active)?.label ?? t('agentMode.default', { defaultValue: 'Default' });
    const currentModelLabel = modelSelection.current_model?.use_model || t('conversation.welcome.selectModel');

    const entries: MobileActionSheetEntry[] = [
      {
        key: 'model',
        icon: <Brain theme='outline' size='16' />,
        label: t('common.model', { defaultValue: 'Model' }),
        meta: currentModelLabel,
        submenu: {
          title: t('common.model', { defaultValue: 'Model' }),
          options: modelOptions,
          onSelect: handleSheetModelSelect,
          emptyText: t('conversation.welcome.selectModel'),
        },
      },
      {
        key: 'permission',
        icon: <Shield theme='outline' size='16' />,
        label: t('agentMode.permission', { defaultValue: 'Permission' }),
        meta: currentModeLabel,
        submenu: {
          title: t('agentMode.permission', { defaultValue: 'Permission' }),
          options: modeOptions,
          onSelect: (key) => void handleSheetModeChange(key),
        },
      },
      ...attachEntries,
    ];

    if (!window.electronAPI) {
      const permissionIndex = entries.findIndex((entry) => entry.key === 'permission');
      if (permissionIndex >= 0) entries.splice(permissionIndex, 1);
    }

    if (runtimeThoughtLevel) {
      entries.splice(1, 0, {
        key: 'thought-level',
        icon: <Brain theme='outline' size='16' />,
        label: t('agent.thoughtLevel.label'),
        meta:
          runtimeThoughtLevel.options.find((item) => item.value === runtimeThoughtLevel.currentValue)?.label ||
          runtimeThoughtLevel.currentValue ||
          '',
        submenu: {
          title: t('agent.thoughtLevel.label'),
          options: runtimeThoughtLevel.options.map((item) => ({
            key: item.value,
            label: item.label,
            description: item.description ?? undefined,
            active: runtimeThoughtLevel.currentValue === item.value,
          })),
          onSelect: (value) => {
            void runtimeConfig
              .setConfigOption(runtimeThoughtLevel.id, value)
              .then(() => Message.success(t('agent.thoughtLevel.switchSuccess')))
              .catch((error) => Message.error(t(configErrorMessageKey(error))));
          },
        },
      });
    }

    if (loadedSkills.length > 0) {
      const skillOptions: MobileActionSheetOption[] = loadedSkills.map((name) => ({
        key: name,
        label: `/${name}`,
      }));
      entries.push({
        key: 'skills',
        icon: <MagicHat theme='outline' size='16' />,
        label: t('common.selectedSkills', { defaultValue: 'Selected skills' }),
        variant: 'muted',
        submenu: {
          title: t('common.selectedSkills', { defaultValue: 'Selected skills' }),
          selectable: false,
          options: skillOptions,
          onSelect: (name) => {
            setContent(`/${name} `);
          },
        },
      });
    }

    if (loadedMcpStatuses.length > 0) {
      const mcpOptions: MobileActionSheetOption[] = loadedMcpStatuses.map((item) => ({
        key: item.id,
        label: item.name,
        description:
          item.status === 'loaded'
            ? undefined
            : item.reason
              ? `${t(`conversation.mcp.status.${item.status}` as const)} · ${item.reason}`
              : t(`conversation.mcp.status.${item.status}` as const),
      }));
      entries.push({
        key: 'mcp',
        icon: <Shield theme='outline' size='16' />,
        label: t('conversation.mcp.selected', { defaultValue: 'Selected MCP' }),
        variant: 'muted',
        submenu: {
          title: t('conversation.mcp.selected', { defaultValue: 'Selected MCP' }),
          selectable: false,
          options: mcpOptions,
          onSelect: () => undefined,
        },
      });
    }

    return entries;
  }, [
    attachEntries,
    currentMode,
    dynamicModes,
    handleSheetModeChange,
    handleSheetModelSelect,
    isMobile,
    loadedMcpStatuses,
    loadedSkills,
    modelSelection,
    runtimeConfig,
    runtimeMode,
    runtimeThoughtLevel,
    setContent,
    t,
  ]);

  // Accept file-selection events only when targeted at this conversation (or
  // untargeted); stops same-type peers on the team route from receiving each
  // other's selections. See emitter EventTypes comment.
  useAddEventListener(
    'aionrs.selected.file',
    (items: Array<string | FileOrFolderItem>, targetConversationId: string | undefined) => {
      if (targetConversationId === undefined || targetConversationId === conversation_id) setAtPath(items);
    },
    [conversation_id, setAtPath]
  );
  useAddEventListener(
    'aionrs.selected.file.append',
    (selectedItems: Array<string | FileOrFolderItem>, targetConversationId: string | undefined) => {
      if (targetConversationId !== undefined && targetConversationId !== conversation_id) return;
      const merged = mergeFileSelectionItems(atPathRef.current, selectedItems);
      if (merged !== atPathRef.current) {
        setAtPath(merged as Array<string | FileOrFolderItem>);
      }
    },
    [conversation_id, setAtPath]
  );

  // Stop conversation handler
  const handleStop = async (): Promise<void> => {
    // Best-effort cancel: swallow rejections so they don't bubble up as
    // unhandled rejections. UI state is still reset via finally.
    const turnId = runtimeView.activeTurnId;
    if (!turnId) {
      resetState();
      resetActiveExecution('stop');
      customerQueue.resetActiveExecution();
      return;
    }
    runtimeView.markStopRequested(turnId);
    try {
      const result = await ipcBridge.conversation.stop.invoke({ conversation_id, turn_id: turnId });
      runtimeView.markStopAcknowledged(turnId, result.runtime);
    } catch (error) {
      console.warn('[AionrsSendBox] stop request failed', error);
      runtimeView.resetLocalGate('stop_failed');
    } finally {
      resetState();
      resetActiveExecution('stop');
      customerQueue.resetActiveExecution();
    }
  };
  const effectiveHandleStop = teamRuntime?.onStop ?? handleStop;
  const handleSendNowQueued = useCallback(
    async (item: ConversationCommandQueueItem) => {
      // Stop the current reply (best-effort), then promote the chosen command
      // to the front of the queue in auto mode.  The drain effect will fire it
      // once the execution gate shows canExecute — avoiding the 409 race that
      // occurs when sendNow() calls onExecute() directly before the backend
      // has finished processing the stop.
      await effectiveHandleStop();
      prioritize(item.id);
    },
    [effectiveHandleStop, prioritize]
  );
  const sendBoxWidthClass = getChatSurfaceWidthClass();

  return (
    <div className={`${sendBoxWidthClass} flex flex-col mt-auto mb-16px`}>
      {isCustomerChat ? (
        <PromptQueuePanel
          items={customerQueue.items}
          active={customerQueue.active}
          onRetry={customerQueue.retry}
          onRemove={customerQueue.remove}
          onEdit={handleEditQueuedCommand}
          canEdit={!content.trim() && uploadFile.length === 0 && atPath.length === 0}
        />
      ) : (
        <CommandQueuePanel
          items={queuedCommands}
          mode={queueMode}
          isMobile={isMobile}
          interactionLocked={isQueueInteractionLocked}
          onInteractionLock={lockInteraction}
          onInteractionUnlock={unlockInteraction}
          onEdit={handleEditQueuedCommand}
          onSendNow={handleSendNowQueued}
          onToggleMode={toggleMode}
          onReorder={reorder}
          onRemove={remove}
          onClear={clear}
        />
      )}
      {!hasInlineActivity && (
        <ThoughtDisplay
          thought={thought}
          running={teamRuntime?.loading ?? running}
          statusText={teamRuntime?.statusText}
          externalElapsedSource={Boolean(teamRuntime) || turnStartedAtMs != null}
          startedAtMs={teamRuntime ? (teamRuntime.startedAtMs ?? null) : turnStartedAtMs}
          onStop={effectiveHandleStop}
          onRetryStart={teamRuntime?.onRetryStart ? () => void teamRuntime.onRetryStart?.() : undefined}
        />
      )}
      <CrossSessionDisabledBanner />
      {!promptBudget.allowed && (
        <div role='alert' className='mb-8px text-t-secondary'>
          {t('conversation.promptTooLarge', { limit: promptBudget.maxBytes })}
        </div>
      )}
      {entryRuntime.phase !== 'ready' && (
        <div
          role={entryRuntime.phase === 'failed' ? 'alert' : 'status'}
          className='flex items-center gap-8px mb-8px text-t-secondary'
        >
          <span>{t(`conversation.entryRuntime.${entryRuntime.phase}`)}</span>
          {entryRuntime.phase === 'failed' && (
            <Button size='mini' onClick={entryRuntime.retry}>
              {t('common.retry')}
            </Button>
          )}
        </div>
      )}
      <SendBox
        data-testid='aionrs-sendbox'
        onMobilePlusClick={isMobile ? () => setIsMobileSheetOpen(true) : undefined}
        value={content}
        onChange={handleContentChange}
        selectedWorkspaceItems={atPath}
        onSelectedWorkspaceItemsChange={(items) => {
          emitter.emit('aionrs.selected.file', items, conversation_id);
          setAtPath(items);
        }}
        selectedSessions={selectedSessions}
        onSelectedSessionsChange={setSelectedSessions}
        crossSessionEnabled={crossSessionEnabled}
        isTeamConversation={Boolean(teamRuntime)}
        loading={teamRuntime?.loading ?? (isBusy && entryRuntime.isReady)}
        active={teamRuntime?.isActive}
        onFocused={teamRuntime?.onFocus}
        disabled={!current_model?.use_model}
        clearAfterAccepted={isCustomerChat}
        sendDisabled={
          (isCustomerChat ? !entryRuntime.isReady || customerQueue.isFull : isBusy) || !promptBudget.allowed
        }
        sendDisabledTooltip={
          !promptBudget.allowed
            ? t('conversation.promptTooLarge', { limit: promptBudget.maxBytes })
            : !entryRuntime.isReady
              ? t(`conversation.entryRuntime.${entryRuntime.phase === 'failed' ? 'failed' : 'preparing'}`)
              : isCustomerChat && customerQueue.isFull
                ? t('conversation.customerQueue.full')
                : !isCustomerChat && isBusy
                  ? t('conversation.commandQueue.midturnBlockedSendHint', {
                      defaultValue:
                        'The current agent is still working and cannot receive another message yet. Add it to Draft box instead.',
                    })
                  : undefined
        }
        placeholder={
          current_model?.use_model
            ? t('acp.sendbox.placeholder', {
                backend: agent_name || t('login.brand'),
                defaultValue: `Send message to {{backend}}...`,
              })
            : t('conversation.chat.noModelSelected')
        }
        onStop={effectiveHandleStop}
        className='z-10'
        onFilesAdded={handleFilesAdded}
        hasPendingAttachments={uploadFile.length > 0 || atPath.length > 0}
        supportedExts={allSupportedExts}
        defaultMultiLine={!isMobile}
        lockMultiLine={!isMobile}
        tools={
          <FileAttachButton
            openFileSelector={openFileSelector}
            onLocalFilesAdded={handleFilesAdded}
            loadedMcpStatuses={loadedMcpStatuses}
          />
        }
        rightTools={
          <div className='flex items-center gap-8px min-w-0'>
            {!window.electronAPI ? (
              <AionrsModelSelector selection={modelSelection} busy={isBusy || modelSelection.isChanging} />
            ) : (
              <AgentModeSelector
                backend='aionrs'
                conversation_id={conversation_id}
                compact
                initialMode={session_mode}
                dynamicModes={dynamicModes}
                compactLeadingIcon={<Shield theme='outline' size='14' fill={iconColors.secondary} />}
                modeLabelFormatter={(mode) => t(`agentMode.${mode.value}`, { defaultValue: mode.label })}
                compactLabelPrefix={t('agentMode.permission')}
                hideCompactLabelPrefixOnMobile
                onModeChanged={propagateMode}
                beforeRuntimeSync={prepareRuntimeConfig}
                beforeRuntimeSet={teamPermission?.warmupSession}
                configOptionsPort={teamPermission?.configOptionsPort}
              />
            )}
          </div>
        }
        prefix={
          <>
            {uploadFile.length > 0 && (
              <HorizontalFileList>
                {uploadFile.map((path) => (
                  <FilePreview
                    key={path}
                    data-testid={`aionrs-file-tag-${uploadFile.indexOf(path)}`}
                    path={path}
                    onRemove={() => setUploadFile(uploadFile.filter((v) => v !== path))}
                  />
                ))}
              </HorizontalFileList>
            )}
            {atPath.some((item) => (typeof item === 'string' ? false : !item.isFile)) && (
              <div className='flex flex-wrap items-center gap-8px mb-8px'>
                {atPath.map((item) => {
                  if (typeof item === 'string') return null;
                  if (!item.isFile) {
                    const folderIndex = atPath.filter((v) => typeof v !== 'string' && !v.isFile).indexOf(item);
                    return (
                      <Tag
                        key={item.path}
                        data-testid={`aionrs-folder-tag-${folderIndex}`}
                        color='blue'
                        closable
                        onClose={() => {
                          const newAtPath = atPath.filter((v) => (typeof v === 'string' ? true : v.path !== item.path));
                          emitter.emit('aionrs.selected.file', newAtPath, conversation_id);
                          setAtPath(newAtPath);
                        }}
                      >
                        {item.name}
                      </Tag>
                    );
                  }
                  return null;
                })}
              </div>
            )}
          </>
        }
        onSend={onSendHandler}
        slash_commands={slash_commands}
        explicitSkills={explicitSkills}
        onSlashBuiltinCommand={onSlashBuiltinCommand}
        onAddToDraft={handleAddToQueue}
        addToDraftDisabled={!canQueueCurrentDraft || !promptBudget.allowed || (isCustomerChat && customerQueue.isFull)}
        addToDraftTooltip={
          isBusy
            ? t('conversation.commandQueue.addToQueueBusyHint', {
                defaultValue: 'Save to Draft box and send it later.',
              })
            : t('conversation.commandQueue.addToQueue', { defaultValue: 'Save to Draft box' })
        }
        allowSendWhileLoading
        sendButtonPrefix={
          teamRuntime?.onInterruptSend && content.trim() ? (
            <Button
              size='mini'
              type='secondary'
              icon={<Lightning />}
              loading={interrupting}
              onClick={() => void handleInterruptSend()}
            >
              {t('team.interruptAndSend')}
            </Button>
          ) : undefined
        }
      />
      {isMobile && (
        <>
          <MobileActionSheet
            open={isMobileSheetOpen}
            onClose={() => setIsMobileSheetOpen(false)}
            title={t('common.more', { defaultValue: 'More' })}
            entries={sheetEntries}
          />
          {attachHiddenInput}
        </>
      )}
    </div>
  );
};

export default AionrsSendBox;

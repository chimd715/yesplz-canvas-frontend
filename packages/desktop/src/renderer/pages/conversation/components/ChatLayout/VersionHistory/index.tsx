import { ipcBridge } from '@/common';
import {
  getActiveNativeRuntimeContext,
  getBuilderWorkspace,
  isNativeRuntimeActive,
  nativeRuntimeActivationEpoch,
  subscribeNativeRuntimeActivation,
  suspendNativeRuntime,
} from '@/common/adapter/httpBridge';
import {
  getConversationRuntimeViewSnapshot,
  subscribeConversationRuntimeView,
} from '@/renderer/pages/conversation/runtime/conversationRuntimeViewStore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { useTranslation } from 'react-i18next';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview';
import {
  captureSourceVersion,
  fetchSourceVersions,
  fetchVersions,
  restoreVersion,
  VersionRequestError,
  sourceVersionsPath,
  versionsPath,
  versionPreviewUrl,
  type VersionSelection,
} from './api';

export { VersionHistoryProvider, useVersionHistory } from './context';
export { versionPreviewUrl } from './api';
export type { SavedVersion, RevertedGroup, VersionHistory, SourceVersion, VersionSelection } from './api';

export function useVersionHistoryState(logicalConversationId: string | undefined) {
  const { openPreview, closePreview } = usePreviewContext();
  const { t } = useTranslation();
  const enabled =
    !!logicalConversationId &&
    typeof document !== 'undefined' &&
    !window.electronAPI &&
    (!!getBuilderWorkspace() || !!document.querySelector('meta[name="ai-builder-preview"][content="enabled"]'));
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    enabled ? `${versionsPath(logicalConversationId!)}/versions` : null,
    fetchVersions,
    {
      shouldRetryOnError: false,
      keepPreviousData: false,
      revalidateOnFocus: true,
      refreshInterval: (history) => (history?.versions.some((version) => version.status === 'building') ? 3000 : 0),
    }
  );
  const activeConversationId = data?.activeCoreConversationId ?? logicalConversationId;
  // null is a successful legacy 404, distinct from an unresolved first request.
  // Retain that same-key decision through a temporary server failure only.
  const retainedLegacyResolution =
    data === null && error instanceof VersionRequestError && error.status >= 500 && error.status < 600;
  const continuationResolved = !enabled || (!isLoading && !(!data && error && !retainedLegacyResolution));
  const sources = useSWR(
    enabled && activeConversationId ? sourceVersionsPath(activeConversationId) : null,
    fetchSourceVersions,
    { shouldRetryOnError: false, keepPreviousData: false, revalidateOnFocus: true }
  );
  const [selected, setSelected] = useState<VersionSelection | null>(null);
  const [saving, setSaving] = useState(false);
  const [snapshotError, setSnapshotError] = useState<'busy' | 'missing' | 'unavailable' | null>(null);
  const sourceRequest = useRef<AbortController | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<'conflict' | 'unavailable' | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    setSelected(null);
    setSaving(false);
    setSnapshotError(null);
    setRestoreError(null);
    setRestoring(false);
    return () => {
      request.current?.abort();
      request.current = null;
      sourceRequest.current?.abort();
      sourceRequest.current = null;
    };
  }, [logicalConversationId]);

  useEffect(() => {
    setSaving(false);
    setSnapshotError(null);
    return () => {
      sourceRequest.current?.abort();
      sourceRequest.current = null;
    };
  }, [activeConversationId]);

  useEffect(() => {
    const activeCoreConversationId = data?.activeCoreConversationId;
    if (!activeCoreConversationId) return;
    return ipcBridge.conversation.turnCompleted?.on((event) => {
      if (event.session_id === activeCoreConversationId) void mutate();
    });
  }, [data?.activeCoreConversationId, mutate]);

  const saveSourceVersion = useCallback(
    async (messageId?: string, completedTurn = false) => {
      if (
        !enabled ||
        !isNativeRuntimeActive() ||
        (getBuilderWorkspace() && getActiveNativeRuntimeContext()?.coreId !== activeConversationId) ||
        !continuationResolved ||
        restoring ||
        !activeConversationId ||
        !sources.data?.configured ||
        sourceRequest.current
      )
        return false;
      const controller = new AbortController();
      sourceRequest.current = controller;
      const epoch = nativeRuntimeActivationEpoch();
      const explicitMessageId = !!messageId;
      const cancelChangedCompletion = () => {
        const runtime = getConversationRuntimeViewSnapshot(activeConversationId);
        if (
          nativeRuntimeActivationEpoch() !== epoch ||
          !isNativeRuntimeActive() ||
          (getBuilderWorkspace() && getActiveNativeRuntimeContext()?.coreId !== activeConversationId) ||
          runtime.localSubmitting ||
          runtime.localStopping ||
          (runtime.hydrated &&
            (runtime.isProcessing ||
              runtime.state !== 'idle' ||
              runtime.pendingConfirmations !== 0 ||
              !!runtime.activeTurnId))
        )
          controller.abort();
      };
      const disposers = completedTurn
        ? [
            subscribeNativeRuntimeActivation(cancelChangedCompletion),
            subscribeConversationRuntimeView(cancelChangedCompletion),
          ]
        : [];
      const checkCompletion = () => {
        if (completedTurn) cancelChangedCompletion();
        controller.signal.throwIfAborted();
      };
      setSaving(true);
      setSnapshotError(null);
      try {
        // Finish delivering this completion to the runtime view before checking it.
        if (completedTurn) await Promise.resolve();
        for (let attempt = 0; ; attempt += 1) {
          checkCompletion();
          try {
            // Core completion can precede its central mirror. Only this bounded
            // completion flow retries; history loading never creates snapshots.
            if (completedTurn && !messageId) {
              const page = await ipcBridge.database.getConversationMessages.invoke({
                conversation_id: activeConversationId,
                limit: 1,
              });
              checkCompletion();
              const latest = page?.items.length === 1 ? page.items[0] : undefined;
              if (
                !latest?.id ||
                latest.conversation_id !== activeConversationId ||
                latest.type !== 'text' ||
                latest.position !== 'left' ||
                latest.status !== 'finish' ||
                latest.hidden !== false
              ) {
                throw new VersionRequestError(409, 'mirror_not_ready');
              }
              messageId = latest.id;
            }
            checkCompletion();
            if (
              !isNativeRuntimeActive() ||
              (getBuilderWorkspace() && getActiveNativeRuntimeContext()?.coreId !== activeConversationId)
            )
              return false;
            const next = await captureSourceVersion(
              activeConversationId,
              AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]),
              messageId
            );
            checkCompletion();
            await sources.mutate(next, { revalidate: false });
            return true;
          } catch (failure) {
            const retryable =
              failure instanceof VersionRequestError &&
              failure.status === 409 &&
              ['mirror_not_ready', 'source_message_mismatch', 'source_busy'].includes(failure.code ?? '');
            if (!completedTurn || !retryable || attempt >= 3) throw failure;
            checkCompletion();
            // An event's explicit ID never moves to a newer message. Only a
            // rejected mirror inference can be resolved again.
            if (!explicitMessageId && failure.code === 'source_message_mismatch') messageId = undefined;
            await new Promise<void>((resolve) => {
              const finish = () => {
                clearTimeout(timer);
                controller.signal.removeEventListener('abort', finish);
                resolve();
              };
              const timer = setTimeout(finish, 1000);
              controller.signal.addEventListener('abort', finish, { once: true });
            });
            checkCompletion();
            // Reconcile before another POST. Unknown/lost responses do not enter
            // this retry path and retain the one-shot reconciliation below.
            const current = await sources.mutate();
            checkCompletion();
            if (explicitMessageId && messageId && current?.cards.some((card) => card.messageId === messageId))
              return true;
          }
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          setSnapshotError(
            failure instanceof VersionRequestError && failure.status === 409
              ? 'busy'
              : failure instanceof VersionRequestError && failure.status === 404
                ? 'missing'
                : 'unavailable'
          );
          // A lost response may follow a successful capture. Reconcile once without recapturing.
          void sources.mutate();
        }
        return false;
      } finally {
        disposers.forEach((dispose) => dispose());
        if (sourceRequest.current === controller) {
          sourceRequest.current = null;
          setSaving(false);
        }
      }
    },
    [enabled, continuationResolved, restoring, activeConversationId, sources.data?.configured, sources.mutate]
  );

  const restore = useCallback(
    async (revisionId: string) => {
      if (
        !data ||
        error ||
        !logicalConversationId ||
        request.current ||
        !data.versions.some((version) => version.id === revisionId)
      )
        return;
      const controller = new AbortController();
      request.current = controller;
      setRestoring(true);
      setRestoreError(null);
      suspendNativeRuntime();
      try {
        const next = await restoreVersion(
          logicalConversationId,
          revisionId,
          data.headGeneration,
          AbortSignal.any([controller.signal, AbortSignal.timeout(180000)])
        );
        if (!controller.signal.aborted) {
          suspendNativeRuntime();
          await mutate(next, { revalidate: false });
          setSelected({ kind: 'native', revisionId, logicalConversationId });
          const version = next.versions.find((item) => item.id === revisionId);
          const previewUrl = version && versionPreviewUrl(version);
          if (previewUrl) {
            openPreview(previewUrl, 'url', {
              title:
                version.label ||
                t('conversation.versions.version', {
                  number: next.versions.findIndex((item) => item.id === revisionId) + 1,
                }),
              editable: false,
            });
          } else {
            // A restored source may still need a preview build; hide the old future.
            closePreview();
          }
        }
      } catch (failure) {
        if (!controller.signal.aborted) {
          setRestoreError(
            failure instanceof VersionRequestError && failure.status === 409 ? 'conflict' : 'unavailable'
          );
          // The operation may have committed before the response was lost.
          void mutate();
        }
      } finally {
        if (request.current === controller) request.current = null;
        if (!controller.signal.aborted) setRestoring(false);
      }
    },
    [data, error, logicalConversationId, mutate, openPreview, closePreview, t]
  );
  const selection: VersionSelection = selected ?? { kind: 'current' };
  const selectedVersion =
    selection.kind === 'native' ? data?.versions.find((version) => version.id === selection.revisionId) : undefined;
  const selectedSourceVersion =
    selection.kind === 'source'
      ? sources.data?.versions.find((version) => version.id === selection.sourceVersionId)
      : undefined;
  const selectVersion = useCallback(
    (revisionId: string) => {
      if (logicalConversationId) {
        setSelected({ kind: 'native', revisionId, logicalConversationId });
        closePreview();
      }
    },
    [logicalConversationId, closePreview]
  );
  const selectSourceVersion = useCallback(
    (sourceVersionId: string) => {
      setSelected({ kind: 'source', sourceVersionId });
      closePreview();
    },
    [closePreview]
  );
  const selectCurrent = useCallback(() => {
    setSelected({ kind: 'current' });
    closePreview();
  }, [closePreview]);
  return useMemo(
    () => ({
      logicalConversationId,
      data,
      error,
      isLoading,
      isValidating,
      restoring,
      restoreError,
      selection,
      selectedVersion,
      selectedSourceVersion,
      sourceHistory: sources.data,
      sourceError: sources.error,
      sourceLoading: sources.isLoading,
      sourceValidating: sources.isValidating,
      sourceEnabled: enabled,
      continuationResolved,
      saving,
      snapshotError,
      selectVersion,
      selectSourceVersion,
      selectCurrent,
      saveSourceVersion,
      restore,
      refresh: () => Promise.all([mutate(), sources.mutate()]),
    }),
    [
      logicalConversationId,
      data,
      error,
      isLoading,
      isValidating,
      restoring,
      restoreError,
      selection,
      selectedVersion,
      selectedSourceVersion,
      sources.data,
      sources.error,
      sources.isLoading,
      sources.isValidating,
      sources.mutate,
      enabled,
      continuationResolved,
      saving,
      snapshotError,
      selectVersion,
      selectSourceVersion,
      selectCurrent,
      saveSourceVersion,
      restore,
      mutate,
    ]
  );
}

export type VersionHistoryState = ReturnType<typeof useVersionHistoryState>;

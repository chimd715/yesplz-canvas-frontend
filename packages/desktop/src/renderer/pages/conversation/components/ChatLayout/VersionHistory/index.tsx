import { ipcBridge } from '@/common';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { useTranslation } from 'react-i18next';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview';
import { fetchVersions, restoreVersion, VersionRequestError, versionsPath, versionPreviewUrl } from './api';

export { VersionHistoryProvider, useVersionHistory } from './context';
export { versionPreviewUrl } from './api';
export type { SavedVersion, RevertedGroup, VersionHistory } from './api';

export function useVersionHistoryState(logicalConversationId: string | undefined) {
  const { openPreview, closePreview } = usePreviewContext();
  const { t } = useTranslation();
  const enabled =
    !!logicalConversationId &&
    typeof document !== 'undefined' &&
    !window.electronAPI &&
    !!document.querySelector('meta[name="ai-builder-preview"][content="enabled"]');
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<'conflict' | 'unavailable' | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    setSelectedId(null);
    setRestoreError(null);
    setRestoring(false);
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [logicalConversationId]);

  useEffect(() => {
    const activeCoreConversationId = data?.activeCoreConversationId;
    if (!activeCoreConversationId) return;
    return ipcBridge.conversation.turnCompleted?.on((event) => {
      if (event.session_id === activeCoreConversationId) void mutate();
    });
  }, [data?.activeCoreConversationId, mutate]);

  const restore = useCallback(
    async (revisionId: string) => {
      if (!data || error || !logicalConversationId || request.current) return;
      const controller = new AbortController();
      request.current = controller;
      setRestoring(true);
      setRestoreError(null);
      try {
        const next = await restoreVersion(
          logicalConversationId,
          revisionId,
          data.headGeneration,
          AbortSignal.any([controller.signal, AbortSignal.timeout(180000)])
        );
        if (!controller.signal.aborted) {
          await mutate(next, { revalidate: false });
          setSelectedId(revisionId);
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
  const selectedVersion = data?.versions.find((version) => version.id === (selectedId ?? data.activeRevisionId));
  return useMemo(
    () => ({
      logicalConversationId,
      data,
      error,
      isLoading,
      isValidating,
      restoring,
      restoreError,
      selectedVersion,
      selectVersion: setSelectedId,
      restore,
      refresh: () => mutate(),
    }),
    [
      logicalConversationId,
      data,
      error,
      isLoading,
      isValidating,
      restoring,
      restoreError,
      selectedVersion,
      restore,
      mutate,
    ]
  );
}

export type VersionHistoryState = ReturnType<typeof useVersionHistoryState>;

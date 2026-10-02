/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useAttachmentUploadScope } from '@/renderer/hooks/file/useAttachmentUploadScope';
import { useConversationContextSafe } from '@/renderer/hooks/context/ConversationContext';
import { FileService, uploadErrorKey, type FileMetadata } from '@/renderer/services/FileService';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { Message } from '@arco-design/web-react';
import { FolderUpload } from '@icon-park/react';
import React, { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { MobileActionSheetEntry } from './types';

interface UseAttachEntryOptions {
  /** Open the host-side file picker (paths from disk via IPC). */
  openFileSelector: () => void;
  /** Receives FileMetadata[] for files uploaded through the browser <input>. WebUI only. */
  onLocalFilesAdded?: (files: FileMetadata[]) => void;
  /** Whether to render the first entry above a divider — passed through. */
  dividerBefore?: boolean;
}

interface UseAttachEntryResult {
  /** One attachment action: native picker on desktop, current device in WebUI. */
  entries: MobileActionSheetEntry[];
  /** Mount this near the sendbox so the hidden file input can be triggered. */
  hiddenFileInput: React.ReactElement;
}

/** Browser customers select files on their own device; only Electron uses host IPC. */
export const useAttachEntry = ({
  openFileSelector,
  onLocalFilesAdded,
  dividerBefore,
}: UseAttachEntryOptions): UseAttachEntryResult => {
  const { t } = useTranslation();
  const conversationContext = useConversationContextSafe();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pickerSignal = useRef<AbortSignal | null>(null);
  const getUploadSignal = useAttachmentUploadScope(conversationContext?.conversation_id);
  const openDevicePicker = useCallback(() => {
    pickerSignal.current = getUploadSignal();
    fileInputRef.current?.click();
  }, [getUploadSignal]);
  const isDesktop = isElectronDesktop();

  const handleLocalFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const signal = pickerSignal.current ?? getUploadSignal();
      const fileList = e.target.files;
      if (signal.aborted) {
        e.target.value = '';
        return;
      }
      if (!fileList || fileList.length === 0 || !onLocalFilesAdded) return;
      try {
        const processed = await FileService.processDroppedFiles(
          fileList,
          conversationContext?.conversation_id,
          'sendbox',
          { signal }
        );
        if (!signal.aborted && processed.length > 0) onLocalFilesAdded(processed);
      } catch (error) {
        if (!signal.aborted) Message.error(t(uploadErrorKey(error)));
      }
      e.target.value = '';
    },
    [conversationContext?.conversation_id, getUploadSignal, onLocalFilesAdded, t]
  );

  const triggerLocalUpload = useCallback(() => {
    openDevicePicker();
  }, [openDevicePicker]);

  const entries = useMemo<MobileActionSheetEntry[]>(
    () => [
      {
        key: 'attach',
        icon: <FolderUpload theme='outline' size='16' />,
        label: t('common.fileAttach.addFiles', { defaultValue: 'Add files' }),
        variant: 'muted',
        dividerBefore,
        onClick: isDesktop ? openFileSelector : triggerLocalUpload,
      },
    ],
    [dividerBefore, isDesktop, openFileSelector, t, triggerLocalUpload]
  );

  const hiddenFileInput = (
    <input
      ref={fileInputRef}
      key={conversationContext?.conversation_id ?? 'home'}
      type='file'
      multiple
      style={{ display: 'none' }}
      onChange={handleLocalFileChange}
      data-testid='mobile-sheet-file-upload-input'
    />
  );

  return { entries, hiddenFileInput };
};

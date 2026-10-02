import { useAttachmentUploadScope } from './useAttachmentUploadScope';
import { ipcBridge } from '@/common';
import { FileService, uploadErrorKey, type FileMetadata } from '@/renderer/services/FileService';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { Message } from '@arco-design/web-react';
import { useCallback, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

type UseOpenFileSelectorOptions = {
  onFilesSelected: (files: string[]) => void;
  onFilesUploaded?: (files: FileMetadata[]) => void;
  conversation_id?: string;
};

type UseOpenFileSelectorResult = {
  openFileSelector: () => void;
  onSlashBuiltinCommand: (name: string) => void;
};

/** Shared '+' and '/open' behavior: device files in WebUI, native paths in Electron. */
export function useOpenFileSelector(options: UseOpenFileSelectorOptions): UseOpenFileSelectorResult {
  const { onFilesSelected, onFilesUploaded, conversation_id } = options;
  const { t } = useTranslation();
  const pendingInputs = useRef(new Set<HTMLInputElement>());
  const getUploadSignal = useAttachmentUploadScope(conversation_id);
  useLayoutEffect(() => {
    return () => {
      for (const input of pendingInputs.current) {
        input.onchange = null;
        input.remove();
      }
      pendingInputs.current.clear();
    };
  }, [conversation_id]);

  const openFileSelector = useCallback(() => {
    const signal = getUploadSignal();
    if (!isElectronDesktop()) {
      // This transient native file-control is never a server filesystem browser.
      // Keep it attached for browser compatibility, then release it on selection,
      // cancellation or unmount. Uploads return managed paths, never device paths.
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.hidden = true;
      document.body.appendChild(input);
      pendingInputs.current.add(input);
      const release = () => {
        pendingInputs.current.delete(input);
        input.remove();
      };
      input.addEventListener('cancel', release, { once: true });
      input.onchange = () => {
        const files = input.files;
        release();
        if (signal.aborted || !files?.length || !onFilesUploaded) return;
        void FileService.processDroppedFiles(files, conversation_id, 'sendbox', { signal })
          .then((uploaded) => {
            if (!signal.aborted && uploaded.length > 0) onFilesUploaded(uploaded);
          })
          .catch((error) => {
            if (!signal.aborted) Message.error(t(uploadErrorKey(error)));
          });
      };
      input.click();
      return;
    }
    void ipcBridge.dialog.showOpen
      .invoke({ properties: ['openFile', 'multiSelections'] })
      .then((files) => {
        if (!signal.aborted && files?.length) onFilesSelected(files);
      })
      .catch(() => {
        if (!signal.aborted) Message.error(t('common.fileAttach.failed'));
      });
  }, [conversation_id, getUploadSignal, onFilesSelected, onFilesUploaded, t]);

  const onSlashBuiltinCommand = useCallback(
    (name: string) => {
      if (name === 'open') openFileSelector();
    },
    [openFileSelector]
  );

  return { openFileSelector, onSlashBuiltinCommand };
}

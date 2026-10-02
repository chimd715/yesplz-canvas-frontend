/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useAttachmentUploadScope } from './useAttachmentUploadScope';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Message } from '@arco-design/web-react';
import type { FileMetadata } from '@renderer/services/FileService';
import { isSupportedFile, FileService, uploadErrorKey } from '@renderer/services/FileService';

export interface UseDragUploadOptions {
  supportedExts?: string[];
  onFilesAdded?: (files: FileMetadata[]) => void;
  /** Conversation ID for WebUI file uploads */
  conversation_id?: string;
}

export const useDragUpload = ({ supportedExts = [], onFilesAdded, conversation_id }: UseDragUploadOptions) => {
  const { t } = useTranslation();
  const getUploadSignal = useAttachmentUploadScope(conversation_id);
  const [isFileDragging, setIsFileDragging] = useState(false);

  // Ignore text/URL drags so moving prompt text retains native browser behavior.
  const hasFiles = (event: React.DragEvent): boolean =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files') || (event.dataTransfer?.files.length ?? 0) > 0;

  // Nested drag events must not flicker the highlight.
  const dragCounter = useRef(0);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    setIsFileDragging(true);
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();

    dragCounter.current += 1;
    setIsFileDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();

    dragCounter.current -= 1;

    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsFileDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();

      // 重置状态
      dragCounter.current = 0;
      setIsFileDragging(false);

      if (!onFilesAdded) return;
      const signal = getUploadSignal();

      try {
        if (Array.from(e.dataTransfer.items ?? []).some((item) => item.webkitGetAsEntry?.()?.isDirectory)) {
          Message.error(t('common.fileAttach.failed'));
          return;
        }
        const droppedFiles = e.dataTransfer.files;

        // 第一步：先校验文件类型，筛选出支持的文件
        const validFiles: File[] = [];

        for (let i = 0; i < droppedFiles.length; i++) {
          const file = droppedFiles[i];
          if (supportedExts.length === 0 || isSupportedFile(file.name, supportedExts)) {
            validFiles.push(file);
          }
          // 注意：不支持的文件会被静默过滤，与原逻辑保持一致
        }

        // 第二步：只处理校验通过的文件
        if (validFiles.length > 0) {
          // 创建 FileList 对象给 processDroppedFiles
          const validFileList = Object.assign(validFiles, {
            length: validFiles.length,
            item: (index: number) => validFiles[index] || null,
          }) as unknown as FileList;
          const processedFiles = await FileService.processDroppedFiles(validFileList, conversation_id, 'sendbox', {
            signal,
          });

          if (!signal.aborted && processedFiles.length > 0) {
            onFilesAdded(processedFiles);
          }
        }
      } catch (err) {
        if (!signal.aborted) Message.error(t(uploadErrorKey(err)));
      }
    },
    [conversation_id, getUploadSignal, onFilesAdded, supportedExts, t]
  );

  const dragHandlers = {
    onDragOver: handleDragOver,
    onDragEnter: handleDragEnter,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
  };

  return {
    isFileDragging,
    dragHandlers,
  };
};

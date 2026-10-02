/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getBaseUrl, resolveCoreCsrfToken } from '@/common/adapter/httpBridge';
import { refreshSession } from '@/common/adapter/sessionRefresh';
import { trackUpload, type UploadSource } from '@/renderer/hooks/file/useUploadState';

/** Sentinel error message used when an upload is cancelled by the caller. */
export const UPLOAD_ABORTED_ERROR = 'Upload aborted';

/** Reserve multipart overhead below Core's 30 MiB request cap. */
export const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024;

/** Map transport failures to safe, localized messages without exposing server details. */
export function uploadErrorKey(error: unknown): 'common.fileAttach.tooLarge' | 'common.fileAttach.failed' {
  return error instanceof Error && error.message === 'FILE_TOO_LARGE'
    ? 'common.fileAttach.tooLarge'
    : 'common.fileAttach.failed';
}

export interface UploadFileOptions {
  /** Cancel the upload from the outside. Closing the XHR also frees the backend connection. */
  signal?: AbortSignal;
}

/**
 * Upload a file to the backend via HTTP multipart.
 *
 * Works in both Electron (via `http://127.0.0.1:<backendPort>`) and WebUI
 * (same-origin reverse-proxied). Core stores attachments in the authenticated
 * user's managed temporary namespace and checks conversation ownership.
 *
 * Field names match the backend contract exactly (snake_case): `file`,
 * `file_name` (optional), `conversation_id` (optional). The response is
 * `ApiResponse<String>` where `data` is the absolute file path on disk.
 *
 * @param onProgress Optional callback receiving upload percentage (0-100).
 * @param options    Optional bag — currently supports an `AbortSignal` so callers can cancel.
 */
export async function uploadFileViaHttp(
  file: File,
  conversation_id?: string,
  onProgress?: (percent: number) => void,
  file_name?: string,
  options?: UploadFileOptions
): Promise<string> {
  if (file.size > MAX_ATTACHMENT_SIZE) throw new Error('FILE_TOO_LARGE');
  if (options?.signal?.aborted) throw new Error(UPLOAD_ABORTED_ERROR);

  const formData = new FormData();
  formData.append('file', file);
  if (file_name) {
    formData.append('file_name', file_name);
  }
  if (conversation_id) {
    formData.append('conversation_id', conversation_id);
  }

  const send = (allowRefresh: boolean): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${getBaseUrl()}/api/fs/upload`);
      // Same-origin cookies authenticate WebUI requests. Do not enable cross-origin
      // credentials: Electron's local Core permits wildcard CORS.
      const csrfToken = resolveCoreCsrfToken();
      if (csrfToken) xhr.setRequestHeader('x-csrf-token', csrfToken);
      xhr.timeout = 120_000;

      // Wire AbortSignal → xhr.abort. Closing the XHR tears down the underlying
      // socket; the backend (axum/multer) treats the truncated multipart body as
      // a client disconnect and stops reading. No explicit cancel IPC needed.
      const signal = options?.signal;
      let onSignalAbort: (() => void) | null = null;
      if (signal) {
        if (signal.aborted) {
          // Caller asked to abort before send — bail out without opening a socket.
          reject(new Error(UPLOAD_ABORTED_ERROR));
          return;
        }
        onSignalAbort = () => {
          try {
            xhr.abort();
          } catch {
            /* ignore */
          }
          detachSignal();
          reject(new Error(UPLOAD_ABORTED_ERROR));
        };
        signal.addEventListener('abort', onSignalAbort);
      }

      const detachSignal = (): void => {
        if (signal && onSignalAbort) {
          signal.removeEventListener('abort', onSignalAbort);
          onSignalAbort = null;
        }
      };

      if (onProgress) {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        });
      }

      xhr.addEventListener('load', () => {
        if (xhr.status === 401 && allowRefresh) {
          // Authentication rejects the request before any file is written, so one
          // replay after the shared session refresh cannot duplicate an upload.
          void refreshSession().then(
            (refreshed) => {
              detachSignal();
              if (signal?.aborted) reject(new Error(UPLOAD_ABORTED_ERROR));
              else if (refreshed) send(false).then(resolve, reject);
              else reject(new Error('UPLOAD_UNAUTHORIZED'));
            },
            () => {
              detachSignal();
              reject(new Error('UPLOAD_UNAUTHORIZED'));
            }
          );
          return;
        }
        detachSignal();
        if (xhr.status === 413) {
          reject(new Error('FILE_TOO_LARGE'));
          return;
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
          return;
        }
        try {
          const result = JSON.parse(xhr.responseText) as { success: boolean; data?: string };
          if (!result.success || typeof result.data !== 'string' || !result.data) {
            reject(new Error('Upload failed: server returned unsuccessful response'));
          } else {
            resolve(result.data);
          }
        } catch {
          reject(new Error('Upload failed: invalid server response'));
        }
      });

      xhr.addEventListener('error', () => {
        detachSignal();
        reject(new Error('Upload failed: network error'));
      });

      xhr.addEventListener('timeout', () => {
        detachSignal();
        reject(new Error('Upload failed: timeout'));
      });

      xhr.addEventListener('abort', () => {
        detachSignal();
        reject(new Error(UPLOAD_ABORTED_ERROR));
      });

      xhr.send(formData);
    });
  return send(true);
}

// ===== 文件类型支持配置 =====
// 注意：当前为预先设计的架构，支持所有文件类型
// 以下常量为将来可能的文件类型过滤功能预留

/** 支持的图片文件扩展名 */
export const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];

/** 支持的音频文件扩展名 */
export const audioExts = ['.mp3', '.wav', '.m4a', '.ogg', '.flac'];

/** 支持的文档文件扩展名 */
export const documentExts = ['.pdf', '.doc', '.docx', '.pptx', '.xlsx', '.odt', '.odp', '.ods'];

/** 支持的文本文件扩展名 */
export const textExts = [
  '.txt',
  '.md',
  '.json',
  '.xml',
  '.csv',
  '.log',
  '.js',
  '.ts',
  '.jsx',
  '.tsx',
  '.html',
  '.css',
  '.scss',
  '.py',
  '.java',
  '.cpp',
  '.c',
  '.h',
  '.go',
  '.rs',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.conf',
  '.config',
];

/** 所有支持的文件扩展名（预先设计，当前实际接受所有文件类型） */
export const allSupportedExts = [...imageExts, ...audioExts, ...documentExts, ...textExts];

// 文件元数据接口
export interface FileMetadata {
  name: string;
  path: string;
  size: number;
  type: string;
  lastModified: number;
}

/**
 * 检查文件是否被支持
 * 注意：当前实现为预先设计的架构，支持所有文件类型
 * supportedExts 参数预留给将来的文件类型过滤功能
 *
 * @param _file_name 文件名（预留参数）
 * @param _supportedExts 支持的文件扩展名数组（预留参数）
 * @returns 总是返回 true，表示支持所有文件类型
 */
export function isSupportedFile(_file_name: string, _supportedExts: string[]): boolean {
  return true; // 预先设计：当前支持所有文件类型
}

// 获取文件扩展名
export function getFileExtension(file_name: string): string {
  const lastDotIndex = file_name.lastIndexOf('.');
  return lastDotIndex > -1 ? file_name.substring(lastDotIndex).toLowerCase() : '';
}

import { AIONUI_TIMESTAMP_REGEX } from '@/common/config/constants';
import { formatByteSize } from '@/renderer/services/i18n/format';

// 清理AionUI时间戳后缀，返回原始文件名
export function cleanAionUITimestamp(file_name: string): string {
  return file_name.replace(AIONUI_TIMESTAMP_REGEX, '$1');
}

// 从文件路径获取清理后的文件名（用于UI显示）
export function getCleanFileName(file_path: string): string {
  const file_name = file_path.split(/[\\/]/).pop() || '';
  return cleanAionUITimestamp(file_name);
}

// 从文件路径数组获取清理后的文件名数组（用于消息格式化）
export function getCleanFileNames(file_paths: string[]): string[] {
  return file_paths.map(getCleanFileName);
}

/**
 * 过滤支持的文件
 * 注意：由于 isSupportedFile 当前总是返回 true，此函数实际不会过滤任何文件
 * 这是预先设计的架构，为将来的文件类型过滤功能预留
 *
 * @param files 文件元数据数组
 * @param supportedExts 支持的文件扩展名数组（预留参数）
 * @returns 当前返回所有文件，未进行过滤
 */
export function filterSupportedFiles(files: FileMetadata[], supportedExts: string[]): FileMetadata[] {
  return files.filter((file) => isSupportedFile(file.name, supportedExts));
}

// 从拖拽事件中提取文件 (纯工具函数，不处理业务逻辑)
export function getFilesFromDropEvent(event: DragEvent): FileMetadata[] {
  const files: FileMetadata[] = [];

  if (!event.dataTransfer?.files) {
    return files;
  }

  for (let i = 0; i < event.dataTransfer.files.length; i++) {
    const file = event.dataTransfer.files[i];
    // Electron 32+ 移除了 File.path，改由 preload 暴露的 webUtils.getPathForFile
    // 提供绝对路径；旧版 Electron / 非 Electron 测试环境回退到遗留的 file.path。
    // In Electron 32+ (this app runs 37) `File.path` is undefined — the dropped
    // Finder item's absolute path must come from the preload bridge instead.
    const electronFile = file as File & { path?: string };

    files.push({
      name: file.name,
      path: window.electronAPI?.getPathForFile?.(file) || electronFile.path || '', // 原始路径，可能为空
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
    });
  }

  return files;
}

// 从拖拽事件中提取文本
export function getTextFromDropEvent(event: DragEvent): string {
  return event.dataTransfer?.getData('text/plain') || '';
}

// 格式化文件大小（统一走 i18n 感知的 formatByteSize）
// `decimals` defaults to 2 to preserve the previous behaviour; callers that must
// distinguish two nearby sizes (e.g. "just over the 1 MB limit" vs "1 MB") can ask
// for more precision. Pass the app language so the decimal separator follows it.
export function formatFileSize(bytes: number, decimals = 2, language?: string): string {
  return formatByteSize(bytes, language, decimals);
}

/**
 * 检查是否为图片文件
 * 注意：由于 isSupportedFile 当前总是返回 true，此函数实际总是返回 true
 * 预先设计的架构，为将来的文件类型判断功能预留
 * 当前未被使用，保留供将来扩展
 */
export function isImageFile(file_name: string): boolean {
  return isSupportedFile(file_name, imageExts);
}

/**
 * 检查是否为文档文件
 * 注意：由于 isSupportedFile 当前总是返回 true，此函数实际总是返回 true
 * 预先设计的架构，为将来的文件类型判断功能预留
 * 当前未被使用，保留供将来扩展
 */
export function isDocumentFile(file_name: string): boolean {
  return isSupportedFile(file_name, documentExts);
}

/**
 * 检查是否为文本文件
 * 注意：由于 isSupportedFile 当前总是返回 true，此函数实际总是返回 true
 * 预先设计的架构，为将来的文件类型判断功能预留
 * 当前未被使用，保留供将来扩展
 */
export function isTextFile(file_name: string): boolean {
  return isSupportedFile(file_name, textExts);
}

class FileServiceClass {
  /**
   * Process files from drag/drop, paste, or the attach button, uploading each
   * via HTTP multipart and returning the backend's managed stored path.
   *
   * Every file is uploaded — even Electron OS drags that expose an absolute
   * `path`. The chat send contract sends attachments as `upload` refs, and the
   * backend rejects any upload path that is not under its managed upload
   * directory (`temp_dir/aionui/...`). Passing the raw device path (the old
   * behaviour) now fails with "uploaded file path is outside the managed upload
   * directory", so we always route through the upload endpoint to obtain a
   * managed path.
   */
  async processDroppedFiles(
    files: FileList,
    conversation_id?: string,
    source: UploadSource = 'sendbox',
    options?: UploadFileOptions
  ): Promise<FileMetadata[]> {
    const processedFiles: FileMetadata[] = [];
    // Validate the batch before uploading any bytes. A size error must not leave
    // the user with an apparently successful but incomplete attachment list.
    for (const file of Array.from(files)) {
      if (file.size > MAX_ATTACHMENT_SIZE) throw new Error('FILE_TOO_LARGE');
    }

    for (let i = 0; i < files.length; i++) {
      if (options?.signal?.aborted) return [];
      const file = files[i];

      // Each upload owns its own AbortController; the tracker exposes an `abort()`
      // that triggers the signal so user-driven cancel and conversation-switch
      // bulk-abort go through the same path.
      const controller = new AbortController();
      const abortForScope = () => controller.abort();
      options?.signal?.addEventListener('abort', abortForScope, { once: true });
      const tracker = trackUpload(file.size, {
        source,
        name: file.name,
        conversationId: conversation_id || undefined,
        onAbort: () => controller.abort(),
      });
      let file_path = '';
      try {
        file_path = await uploadFileViaHttp(file, conversation_id || '', tracker.onProgress, undefined, {
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof Error && error.message === UPLOAD_ABORTED_ERROR) {
          // Leaving a composer cancels the entire selection, including queued
          // files. A single-file cancel may keep the rest of the selection.
          if (options?.signal?.aborted) return [];
          continue;
        }
        // Surface failures to the caller's localized toast rather than silently
        // sending a prompt without the files the customer selected.
        throw error;
      } finally {
        options?.signal?.removeEventListener('abort', abortForScope);
        tracker.finish();
      }

      if (options?.signal?.aborted) return [];
      processedFiles.push({
        name: file.name,
        path: file_path,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
      });
    }

    return processedFiles;
  }
}

export const FileService = new FileServiceClass();

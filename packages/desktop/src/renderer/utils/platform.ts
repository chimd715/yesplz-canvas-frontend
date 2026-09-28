/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Platform detection utilities
 * 平台检测工具函数
 */

import { getBaseUrl } from '@/common/adapter/httpBridge';
import { getCurrentConversation } from '@/renderer/pages/conversation/explorer/currentConversationStore';
import builderLogo from '@renderer/assets/logos/brand/yesplz-ai.svg';

/**
 * Check if running in Electron desktop environment
 * 检测是否运行在 Electron 桌面环境
 */
export const isElectronDesktop = (): boolean => {
  return typeof window !== 'undefined' && Boolean(window.electronAPI);
};

/**
 * Check if running on macOS
 * 检测是否运行在 macOS
 */
export const isMacOS = (): boolean => {
  return typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent);
};

/**
 * Check if running on Windows
 * 检测是否运行在 Windows
 */
export const isWindows = (): boolean => {
  return typeof navigator !== 'undefined' && /win/i.test(navigator.userAgent);
};

/**
 * Check if running on Linux
 * 检测是否运行在 Linux
 */
export const isLinux = (): boolean => {
  return typeof navigator !== 'undefined' && /linux/i.test(navigator.userAgent);
};

function isAbsoluteAssetUrl(url: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith('//');
}

/**
 * Resolve a backend-served asset URL for the current environment.
 * In Electron, renderer pages are file:// based, so backend-relative paths
 * must be expanded against the backend HTTP origin.
 */
export const resolveBackendAssetUrl = (url: string | undefined): string | undefined => {
  if (!url) return url;
  if (url.split(/[?#]/, 1)[0] === '/api/assets/logos/brand/aion.svg') return builderLogo;
  if (isAbsoluteAssetUrl(url) || /^data:/i.test(url)) return url;
  if (url.startsWith('/')) {
    return isElectronDesktop() ? `${getBaseUrl()}${url}` : url;
  }
  return url;
};

/**
 * Resolve an extension asset URL for the current environment.
 * Backend-managed extension assets are already emitted as HTTP URLs, so this
 * helper resolves app-relative backend paths into absolute backend URLs when
 * the desktop renderer is not same-origin with the backend process.
 *
 * 将扩展资源 URL 转换为当前环境可用的地址
 */
export const resolveExtensionAssetUrl = (url: string | undefined): string | undefined => {
  return resolveBackendAssetUrl(url);
};

/**
 * Open external URL in the appropriate context
 * - Electron: uses shell.openExternal via IPC (opens on local machine)
 * - WebUI: uses window.open in client browser (opens on remote client)
 *
 * 在适当的环境中打开外部链接
 * - Electron: 通过 IPC 调用 shell.openExternal（在本地机器打开）
 * - WebUI: 使用 window.open 在客户端浏览器打开（在远程客户端打开）
 */
export const openExternalUrl = async (url: string): Promise<void> => {
  if (!url) return;

  if (isElectronDesktop()) {
    const { ipcBridge } = await import('@/common');
    await ipcBridge.shell.openExternal.invoke(url);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
};

/** Hosted loopback links refer to the current conversation's private app. */
export const isHostedPreviewUrl = (value: string): boolean => {
  if (!document.querySelector('meta[name="ai-builder-preview"][content="enabled"]')) return false;
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    );
  } catch {
    return false;
  }
};

/** Open a WebUI link, or load an owned app into an existing named preview frame. */
export const openWebBrowserUrl = (value: string, frameName?: string): boolean => {
  if (isElectronDesktop()) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
  if (!isHostedPreviewUrl(url.href)) {
    void openExternalUrl(url.href);
    return true;
  }
  const routeId = /^#\/conversation\/([A-Za-z0-9_-]{1,100})$/.exec(window.location.hash.split('?')[0])?.[1];
  const conversationId = routeId ? (getCurrentConversation() ?? routeId) : undefined;
  if (!conversationId) return false;
  // The gateway resolves the listener from owned metadata. Never send the link's host, port or path.
  const form = document.createElement('form'),
    input = document.createElement('input');
  form.method = 'post';
  form.action = frameName ? '/api/platform/preview/embed' : '/api/platform/preview';
  form.target = frameName || '_blank';
  if (!frameName) form.rel = 'noopener';
  input.type = 'hidden';
  input.name = 'conversationId';
  input.value = conversationId;
  form.append(input);
  document.body.append(form);
  try {
    form.submit();
  } finally {
    form.remove();
  }
  return true;
};

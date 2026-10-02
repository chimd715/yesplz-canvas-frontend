/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import React, { type ReactNode } from 'react';
import { ipcBridge } from '@/common';
import { PreviewProvider, usePreviewContext } from '@/renderer/pages/conversation/Preview/context/PreviewContext';

vi.mock('@/common', () => ({
  ipcBridge: {
    fileStream: {
      contentUpdate: { on: vi.fn(() => vi.fn()) },
    },
    preview: {
      open: { on: vi.fn(() => vi.fn()) },
    },
    fs: {
      writeContent: { invoke: vi.fn().mockResolvedValue(true) },
      getContentMetadata: { invoke: vi.fn().mockResolvedValue({ lastModified: 300 }) },
      writeFile: { invoke: vi.fn() },
      getFileMetadata: { invoke: vi.fn() },
      readFile: { invoke: vi.fn() },
      getImageBase64: { invoke: vi.fn() },
    },
  },
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: {
    on: vi.fn(),
    off: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'en' },
  }),
}));

describe('PreviewContext', () => {
  const wrapper = ({ children }: { children: ReactNode }) => <PreviewProvider>{children}</PreviewProvider>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('initializes with closed state', () => {
    const { result } = renderHook(() => usePreviewContext(), { wrapper });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.tabs).toEqual([]);
    expect(result.current.activeTabId).toBe(null);
  });

  it('opens a fresh generated version without overwriting dirty content or its save-conflict version', async () => {
    const { result } = renderHook(() => usePreviewContext(), { wrapper });
    const fileRef = { kind: 'project' as const, pe_id: 'pe', relative_path: 'report.md' };
    act(() => result.current.openPreview('version one', 'markdown', { fileRef, lastModified: 100 }));
    const dirtyId = result.current.activeTabId!;
    act(() => result.current.updateContent('my unsaved edits'));
    act(() =>
      result.current.openPreview(
        'version two',
        'markdown',
        { fileRef, lastModified: 200, saveIfMatch: 200, generatedArtifact: true },
        { replace: true, preserveDirty: true }
      )
    );
    expect(result.current.tabs).toHaveLength(2);
    expect(result.current.activeTabId).not.toBe(dirtyId);
    expect(result.current.tabs.find((tab) => tab.id === dirtyId)?.content).toBe('my unsaved edits');
    expect(result.current.tabs.find((tab) => tab.id === dirtyId)?.isDirty).toBe(true);
    await act(async () => {
      await result.current.saveContent(dirtyId);
    });
    expect(ipcBridge.fs.writeContent.invoke).toHaveBeenCalledWith({
      file: fileRef,
      data: 'my unsaved edits',
      ifMatch: 100,
    });
  });

  it('opens preview and creates tab', () => {
    const { result } = renderHook(() => usePreviewContext(), { wrapper });
    act(() => {
      result.current.openPreview('# Hello', 'markdown', { title: 'test.md' });
    });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].content).toBe('# Hello');
    expect(result.current.tabs[0].content_type).toBe('markdown');
  });

  // `closePreview` hides the panel and KEEPS the tabs. It used to also empty them,
  // which propagated to storage and wiped the whole project's remembered tab list —
  // see clearPreviewForScope for the discarding variant.
  it('closes the panel but keeps its tabs', () => {
    const { result } = renderHook(() => usePreviewContext(), { wrapper });
    act(() => {
      result.current.openPreview('content', 'code');
    });
    act(() => {
      result.current.closePreview();
    });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.tabs).toHaveLength(1);
  });

  it('discards tabs only when asked to explicitly', () => {
    const { result } = renderHook(() => usePreviewContext(), { wrapper });
    act(() => {
      result.current.openPreview('content', 'code');
    });
    act(() => {
      result.current.clearPreviewForScope();
    });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.tabs).toEqual([]);
  });

  it('provides all context API methods', () => {
    const { result } = renderHook(() => usePreviewContext(), { wrapper });
    expect(typeof result.current.openPreview).toBe('function');
    expect(typeof result.current.closePreview).toBe('function');
    expect(typeof result.current.updateContent).toBe('function');
    expect(typeof result.current.findPreviewTab).toBe('function');
  });

  it('updates content and marks tab as dirty', () => {
    const { result } = renderHook(() => usePreviewContext(), { wrapper });
    act(() => {
      result.current.openPreview('original', 'code');
    });
    expect(result.current.activeTab?.isDirty).toBe(false);
    act(() => {
      result.current.updateContent('modified');
    });
    expect(result.current.activeTab?.content).toBe('modified');
    expect(result.current.activeTab?.isDirty).toBe(true);
  });

  it('starts non-maximized and toggles the maximized flag', () => {
    const { result } = renderHook(() => usePreviewContext(), { wrapper });
    expect(result.current.isMaximized).toBe(false);
    act(() => {
      result.current.toggleMaximized();
    });
    expect(result.current.isMaximized).toBe(true);
    act(() => {
      result.current.toggleMaximized();
    });
    expect(result.current.isMaximized).toBe(false);
  });

  it('resets maximized when the panel is collapsed', () => {
    const { result } = renderHook(() => usePreviewContext(), { wrapper });
    act(() => {
      result.current.openPreview('content', 'code');
      result.current.toggleMaximized();
    });
    expect(result.current.isMaximized).toBe(true);
    act(() => {
      result.current.closePreview();
    });
    expect(result.current.isMaximized).toBe(false);
  });

  it('resets maximized when tabs are discarded for the scope', () => {
    const { result } = renderHook(() => usePreviewContext(), { wrapper });
    act(() => {
      result.current.openPreview('content', 'code');
      result.current.toggleMaximized();
    });
    expect(result.current.isMaximized).toBe(true);
    act(() => {
      result.current.clearPreviewForScope();
    });
    expect(result.current.isMaximized).toBe(false);
  });

  it('resets maximized when switching to a different preview scope', () => {
    const { result } = renderHook(() => usePreviewContext(), { wrapper });
    act(() => {
      result.current.openPreview('content', 'code');
      result.current.toggleMaximized();
    });
    expect(result.current.isMaximized).toBe(true);
    act(() => {
      result.current.closePreviewIfScopeChanged('project:some-other-project' as PreviewScopeKey);
    });
    expect(result.current.isMaximized).toBe(false);
  });
});

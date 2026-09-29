/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcBridge } from '@/common';
import { useConversationAssistants } from '@/renderer/pages/conversation/hooks/useConversationAssistants';
import type { Assistant } from '@/common/types/agent/assistantTypes';

vi.mock('@/common', () => ({
  ipcBridge: {
    assistants: {
      list: { invoke: vi.fn() },
    },
  },
}));

const activation = vi.hoisted(() => ({ active: true, epoch: 0, listeners: new Set<() => void>() }));
const wrapper = ({ children }: PropsWithChildren) =>
  createElement(SWRConfig, { value: { provider: () => new Map() } }, children);
vi.mock('@/common/adapter/httpBridge', () => ({
  isNativeRuntimeActive: () => activation.active,
  nativeRuntimeActivationEpoch: () => activation.epoch,
  subscribeNativeRuntimeActivation: (listener: () => void) => {
    activation.listeners.add(listener);
    return () => activation.listeners.delete(listener);
  },
}));

describe('useConversationAssistants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activation.active = true;
    activation.epoch = 0;
    activation.listeners.clear();
  });

  it('defers assistant lookup until explicit runtime activation', async () => {
    activation.active = false;
    (ipcBridge.assistants.list.invoke as never as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const { result } = renderHook(() => useConversationAssistants(), { wrapper });
    expect(result.current.presetAssistants).toEqual([]);
    await result.current.refresh();
    expect(ipcBridge.assistants.list.invoke).not.toHaveBeenCalled();
    act(() => {
      activation.active = true;
      activation.epoch++;
      activation.listeners.forEach((listener) => listener());
    });
    await waitFor(() => expect(ipcBridge.assistants.list.invoke).toHaveBeenCalledTimes(1));
  });

  it('loads only enabled assistants from the backend catalog', async () => {
    (ipcBridge.assistants.list.invoke as never as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'bare-aionrs', name: 'Aion CLI', enabled: true, source: 'generated' },
      { id: 'disabled-writer', name: 'Writer', enabled: false, source: 'user' },
      { id: 'assistant-1', name: 'Researcher', source: 'user' },
    ] satisfies Partial<Assistant>[]);

    const { result } = renderHook(() => useConversationAssistants(), { wrapper });

    await waitFor(() => expect(result.current.presetAssistants).toHaveLength(2));

    expect(result.current.presetAssistants.map((assistant) => assistant.id)).toEqual(['bare-aionrs', 'assistant-1']);
  });

  it('keeps the filtered assistant list stable across rerenders when SWR data is unchanged', async () => {
    const catalog = [
      { id: 'bare-aionrs', name: 'Aion CLI', enabled: true, source: 'generated' },
      { id: 'assistant-1', name: 'Researcher', source: 'user' },
    ] satisfies Partial<Assistant>[];

    (ipcBridge.assistants.list.invoke as never as ReturnType<typeof vi.fn>).mockResolvedValue(catalog);

    const { result, rerender } = renderHook(() => useConversationAssistants(), { wrapper });

    await waitFor(() => expect(result.current.presetAssistants).toHaveLength(2));

    const firstRenderAssistants = result.current.presetAssistants;
    rerender();

    expect(result.current.presetAssistants).toBe(firstRenderAssistants);
  });
});

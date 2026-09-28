/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { act, render, fireEvent, screen, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const onStateChangedHandlers: Array<(payload: { name: string; status: string; error?: string }) => void> = [];

vi.mock('swr', () => ({
  mutate: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    hub: {
      getExtensionList: {
        invoke: vi.fn().mockResolvedValue([
          {
            name: 'agent-a',
            display_name: 'Agent A',
            description: 'demo',
            status: 'not_installed',
            hubs: ['acpAdapters'],
          },
        ]),
      },
      onStateChanged: {
        on: vi.fn((handler) => {
          onStateChangedHandlers.push(handler);
          return vi.fn();
        }),
      },
      install: { invoke: vi.fn().mockResolvedValue(undefined) },
      retryInstall: { invoke: vi.fn().mockResolvedValue(undefined) },
      update: { invoke: vi.fn().mockResolvedValue(undefined) },
    },
  },
}));

vi.mock('@/renderer/utils/model/agentLogo', () => ({
  useAgentLogos: () => ({}),
  resolveAgentAvatar: () => ({ kind: 'fallback' }),
}));
vi.mock('@/renderer/pages/settings/components/SettingsPageWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}));
import PluginsSettings from '@/renderer/pages/settings/ToolsSettings/PluginsSettings';
import { ipcBridge } from '@/common';

import { mutate } from 'swr';
import { useHubAgents } from '@/renderer/hooks/agent/useHubAgents';

describe('useHubAgents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onStateChangedHandlers.length = 0;
  });

  it('refreshes managed-agent and assistant caches when an install completes', async () => {
    renderHook(() => useHubAgents());

    await waitFor(() => {
      expect(onStateChangedHandlers).toHaveLength(1);
    });

    await act(async () => {
      onStateChangedHandlers[0]({ name: 'agent-a', status: 'installed' });
    });

    expect(mutate).toHaveBeenCalledWith('agents.managed');
    expect(mutate).toHaveBeenCalledWith('assistants.list');
  });
});

it('shows Shopify independently of an empty agent catalog without starting authentication or installation', async () => {
  vi.clearAllMocks();
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(Response.json({ available: false, connected: false }));
  render(React.createElement(MemoryRouter, null, React.createElement(PluginsSettings)));
  fireEvent.click(screen.getByRole('button', { name: 'settings.plugins.details' }));
  await waitFor(() => expect(screen.getByText('settings.plugins.shopify.pending')).toBeVisible());
  expect(screen.getByRole('button', { name: 'settings.plugins.shopify.connect' })).toBeDisabled();
  expect(screen.getByText('settings.plugins.shopify.setup')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'settings.plugins.back' }));
  expect(screen.getByRole('button', { name: 'settings.plugins.details' })).toBeVisible();
  expect(ipcBridge.hub.getExtensionList.invoke).not.toHaveBeenCalled();
  expect(ipcBridge.hub.install.invoke).not.toHaveBeenCalled();
  fetchMock.mockRestore();
});

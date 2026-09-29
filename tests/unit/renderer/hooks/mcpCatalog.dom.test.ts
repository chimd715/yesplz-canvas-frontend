/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { getClientBusinessSettingMock, mcpServiceMock, extensionsMock } = vi.hoisted(() => ({
  extensionsMock: { getMcpServers: { invoke: vi.fn() } },
  getClientBusinessSettingMock: vi.fn(),
  mcpServiceMock: {
    listServers: { invoke: vi.fn() },
  },
}));

vi.mock('@/renderer/services/clientBusinessSettings', () => ({
  getClientBusinessSetting: getClientBusinessSettingMock,
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  mcpService: mcpServiceMock,
  extensions: extensionsMock,
}));

import { ensureBackendMcpCatalog } from '@/renderer/hooks/mcp/catalog';

describe('ensureBackendMcpCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getClientBusinessSettingMock.mockResolvedValue([]);
    extensionsMock.getMcpServers.invoke.mockResolvedValue([]);
    mcpServiceMock.listServers.invoke.mockResolvedValue([
      {
        id: 'user-1',
        name: 'user one',
        enabled: true,
        transport: { type: 'stdio', command: 'user', args: [] },
        created_at: 2,
        updated_at: 2,
        original_json: '{}',
        builtin: false,
      },
    ]);
  });

  it('includes Extension transports once while preserving a user override by name', async () => {
    extensionsMock.getMcpServers.invoke.mockResolvedValue([
      {
        id: 'ext-yesplz',
        name: 'yesplz-api-reference',
        _extensionName: 'yesplz-api',
        transport: { type: 'http', url: 'https://mcp.example/api/mcp' },
      },
      { id: 'shadowed', name: 'user one', _extensionName: 'other' },
    ]);
    const result = await ensureBackendMcpCatalog();
    expect(result.allServers.map((s) => s.id)).toEqual(['user-1', 'ext-yesplz']);
    expect(result.extensionServers).toEqual([expect.objectContaining({ extension: 'yesplz-api', id: 'ext-yesplz' })]);
  });

  it('preserves user MCP entries when the optional Extension endpoint fails', async () => {
    extensionsMock.getMcpServers.invoke.mockRejectedValue(new Error('Unavailable'));
    const result = await ensureBackendMcpCatalog();
    expect(result.allServers.map((s) => s.id)).toEqual(['user-1']);
    expect(result.extensionServers).toEqual([]);
  });

  it('reads MCP catalog from backend settings without falling back to configService', async () => {
    getClientBusinessSettingMock.mockResolvedValue([
      {
        id: 'builtin-1',
        name: 'builtin one',
        enabled: true,
        transport: { type: 'stdio', command: 'builtin', args: [] },
        created_at: 1,
        updated_at: 1,
        original_json: '{}',
        builtin: true,
      },
    ]);

    const result = await ensureBackendMcpCatalog();

    expect(result.userServers).toHaveLength(1);
    expect(result.builtinServers).toHaveLength(1);
    expect(result.allServers).toHaveLength(2);
  });

  it('does not re-import legacy user MCP rows from backend client settings at runtime', async () => {
    getClientBusinessSettingMock.mockResolvedValue([
      {
        id: 'legacy-user-1',
        name: 'legacy user server',
        enabled: true,
        transport: { type: 'stdio', command: 'legacy-user', args: [] },
        created_at: 1,
        updated_at: 1,
        original_json: '{}',
        builtin: false,
      },
    ]);
    mcpServiceMock.listServers.invoke.mockResolvedValue([]);

    const result = await ensureBackendMcpCatalog();

    expect(result.userServers).toEqual([]);
    expect(result.builtinServers).toEqual([]);
    expect(result.allServers).toEqual([]);
  });
});

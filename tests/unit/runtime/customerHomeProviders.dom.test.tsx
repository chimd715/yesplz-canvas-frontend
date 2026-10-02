import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';
import type { IProvider } from '@/common/config/storage';
import { useGuidModelSelection } from '@/renderer/pages/guid/hooks/useGuidModelSelection';

const environment = vi.hoisted(() => ({ desktop: false, list: vi.fn() }));
vi.mock('@/common', () => ({ ipcBridge: { mode: { listProviders: { invoke: environment.list } } } }));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => environment.desktop }));
vi.mock('@/renderer/hooks/agent/useGoogleAuthModels', () => ({
  useGoogleAuthModels: () => ({ isGoogleAuth: false }),
}));
const provider = {
  id: 'local-development-mock',
  name: 'Local mock',
  platform: 'custom',
  models: ['mock-local'],
} as IProvider;
const mount = () => {
  const cache = new Map();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>{children}</SWRConfig>
  );
  return renderHook(() => useGuidModelSelection(), { wrapper });
};

describe('home model bootstrap', () => {
  beforeEach(() => {
    environment.desktop = false;
    environment.list.mockReset();
  });

  it('recovers an empty cold-start catalog and stops polling once its configured mock becomes available', async () => {
    environment.list.mockResolvedValueOnce([]).mockResolvedValue([provider]);
    const { result, unmount } = mount();
    await waitFor(() => expect(environment.list).toHaveBeenCalledOnce());
    expect(result.current.current_model).toBeUndefined();
    await waitFor(() => expect(result.current.current_model?.use_model).toBe('mock-local'), { timeout: 2500 });
    expect(result.current.current_model?.id).toBe('local-development-mock');
    expect(environment.list).toHaveBeenCalledTimes(2);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });
    expect(environment.list).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('preserves the stable desktop catalog policy', async () => {
    environment.desktop = true;
    environment.list.mockResolvedValue([]);
    const { unmount } = mount();
    await waitFor(() => expect(environment.list).toHaveBeenCalledOnce());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });
    expect(environment.list).toHaveBeenCalledOnce();
    unmount();
  });
});

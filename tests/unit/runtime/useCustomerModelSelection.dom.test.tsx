import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import { useAionrsModelSelection } from '@/renderer/pages/conversation/platforms/aionrs/useAionrsModelSelection';
import { getCustomerModelProviders } from '@/common/utils/modelCapabilities';

const environment = vi.hoisted(() => ({ desktop: false, providers: [] as IProvider[] }));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => environment.desktop }));
vi.mock('@/renderer/hooks/agent/useModelProviderList', () => ({
  useModelProviderList: () => ({
    providers: environment.providers,
    getAvailableModels: (provider: IProvider) => provider.models,
    formatModelLabel: (_provider: IProvider, model: string) => model,
  }),
}));

const provider = {
  id: 'configured-provider',
  name: 'Configured provider',
  platform: 'custom',
  models: ['deepseek/deepseek-v4.1-flash', 'z-ai/glm-5.3', 'z-ai/glm-5.3-flash', 'unsupported'],
} as IProvider;
const initialModel = { ...provider, use_model: provider.models[0] } as TProviderWithModel;
const deferred = () => {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('customer model selection', () => {
  beforeEach(() => {
    environment.desktop = false;
    environment.providers = [provider];
  });

  it('uses configured IDs, respects disabled entries, preserves mock and leaves provider records unchanged', () => {
    const local = { ...provider, id: 'local-development-mock', models: ['mock-local'] };
    const configured = { ...provider, model_enabled: { 'z-ai/glm-5.3': false } };
    const disabled = { ...provider, id: 'disabled', enabled: false };
    const result = getCustomerModelProviders([configured, local, disabled]);
    expect(result.map((item) => item.id)).toEqual(['configured-provider', 'local-development-mock']);
    expect(result[0].models).toEqual(['deepseek/deepseek-v4.1-flash', 'z-ai/glm-5.3-flash']);
    expect(result[1].models).toEqual(['mock-local']);
    expect(provider.models).toHaveLength(4);
  });

  it('preserves desktop models beyond the customer catalog', () => {
    environment.desktop = true;
    const { result } = renderHook(() => useAionrsModelSelection({ initialModel, onSelectModel: vi.fn() }));
    expect(result.current.providers[0].models).toContain('unsupported');
  });

  it('synchronously admits only one change and applies it only after server acceptance', async () => {
    const pending = deferred();
    const select = vi.fn(() => pending.promise);
    const { result } = renderHook(() => useAionrsModelSelection({ initialModel, onSelectModel: select }));
    let first!: Promise<void>;
    act(() => {
      first = result.current.handleSelectModel(provider, 'z-ai/glm-5.3');
      void result.current.handleSelectModel(provider, 'z-ai/glm-5.3-flash');
    });
    expect(select).toHaveBeenCalledOnce();
    expect(result.current.isChanging).toBe(true);
    expect(result.current.current_model?.use_model).toBe(provider.models[0]);
    await act(async () => {
      pending.resolve(true);
      await first;
    });
    expect(result.current.current_model?.use_model).toBe('z-ai/glm-5.3');
    expect(result.current.isChanging).toBe(false);
  });

  it('retains the current model on rejection and permits an explicit retry', async () => {
    const select = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { result } = renderHook(() => useAionrsModelSelection({ initialModel, onSelectModel: select }));
    await act(async () => {
      await result.current.handleSelectModel(provider, 'z-ai/glm-5.3');
    });
    expect(result.current.current_model?.use_model).toBe(provider.models[0]);
    await act(async () => {
      await result.current.handleSelectModel(provider, 'z-ai/glm-5.3');
    });
    expect(result.current.current_model?.use_model).toBe('z-ai/glm-5.3');
    expect(select).toHaveBeenCalledTimes(2);
  });

  it('releases its switch lock when the transport throws', async () => {
    const select = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(true);
    const { result } = renderHook(() => useAionrsModelSelection({ initialModel, onSelectModel: select }));
    await act(async () => {
      await expect(result.current.handleSelectModel(provider, 'z-ai/glm-5.3')).rejects.toThrow('offline');
    });
    expect(result.current.isChanging).toBe(false);
    expect(result.current.current_model?.use_model).toBe(provider.models[0]);
    await act(async () => {
      await result.current.handleSelectModel(provider, 'z-ai/glm-5.3');
    });
    expect(result.current.current_model?.use_model).toBe('z-ai/glm-5.3');
  });

  it('does not apply a late acceptance to a different conversation', async () => {
    const pending = deferred();
    const select = vi.fn(() => pending.promise);
    const { result, rerender } = renderHook(
      ({ scopeKey }) => useAionrsModelSelection({ initialModel, onSelectModel: select, scopeKey }),
      { initialProps: { scopeKey: 'a' } }
    );
    let first!: Promise<void>;
    act(() => {
      first = result.current.handleSelectModel(provider, 'z-ai/glm-5.3');
    });
    rerender({ scopeKey: 'b' });
    await act(async () => {
      pending.resolve(true);
      await first;
    });
    expect(result.current.current_model?.use_model).toBe(provider.models[0]);
  });

  it('rejects unavailable models without issuing a request', async () => {
    const select = vi.fn();
    const { result } = renderHook(() => useAionrsModelSelection({ initialModel, onSelectModel: select }));
    await result.current.handleSelectModel(provider, 'unsupported');
    await result.current.handleSelectModel({ ...provider, id: 'forged-provider' }, 'z-ai/glm-5.3');
    expect(select).not.toHaveBeenCalled();
  });
});

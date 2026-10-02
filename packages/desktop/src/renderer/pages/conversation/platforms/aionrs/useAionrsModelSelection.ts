/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import { useModelProviderList } from '@/renderer/hooks/agent/useModelProviderList';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCustomerModelProviders } from '@/common/utils/modelCapabilities';
import { isElectronDesktop } from '@/renderer/utils/platform';

export type AionrsModelSelection = {
  current_model?: TProviderWithModel;
  isChanging?: boolean;
  providers: IProvider[];
  getAvailableModels: (provider: IProvider) => string[];
  handleSelectModel: (provider: IProvider, modelName: string) => Promise<void>;
  getDisplayModelName: (modelName?: string) => string;
};

export type UseAionrsModelSelectionOptions = {
  initialModel: TProviderWithModel | undefined;
  scopeKey?: string;
  onSelectModel: (provider: IProvider, modelName: string) => Promise<boolean>;
};

export const useAionrsModelSelection = ({
  initialModel,
  scopeKey,
  onSelectModel,
}: UseAionrsModelSelectionOptions): AionrsModelSelection => {
  const [isChanging, setIsChanging] = useState(false);
  const switching = useRef(false);
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [current_model, setCurrentModel] = useState<TProviderWithModel | undefined>(initialModel);

  useEffect(() => {
    setCurrentModel(initialModel);
  }, [scopeKey, initialModel?.id, initialModel?.use_model]);

  const { providers: allProviders, getAvailableModels, formatModelLabel } = useModelProviderList();

  // AionCore does not support Google Auth — filter it out
  const providers = useMemo(() => {
    const compatible = allProviders.filter((p) => !p.platform?.toLowerCase().includes('gemini-with-google-auth'));
    return isElectronDesktop() ? compatible : getCustomerModelProviders(compatible);
  }, [allProviders]);

  const handleSelectModel = useCallback(
    async (provider: IProvider, modelName: string) => {
      if (
        switching.current ||
        !providers.some((item) => item.id === provider.id && getAvailableModels(item).includes(modelName))
      )
        return;
      if (current_model?.id === provider.id && current_model.use_model === modelName) return;
      const requestScope = scopeKey;
      switching.current = true;
      setIsChanging(true);
      const selected = {
        ...(provider as unknown as TProviderWithModel),
        use_model: modelName,
      } as TProviderWithModel;
      try {
        const ok = await onSelectModel(provider, modelName);
        if (ok && mounted.current && currentScope.current === requestScope) setCurrentModel(selected);
      } finally {
        switching.current = false;
        if (mounted.current) setIsChanging(false);
      }
    },
    [onSelectModel, providers, getAvailableModels, current_model, scopeKey]
  );

  const getDisplayModelName = useCallback(
    (modelName?: string) => {
      if (!modelName) return '';
      const label = formatModelLabel(current_model, modelName);
      const maxLength = 20;
      return label.length > maxLength ? `${label.slice(0, maxLength)}...` : label;
    },
    [current_model, formatModelLabel]
  );

  return {
    current_model,
    isChanging,
    providers,
    getAvailableModels,
    handleSelectModel,
    getDisplayModelName,
  };
};

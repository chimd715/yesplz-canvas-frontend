/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Assistant } from '@/common/types/agent/assistantTypes';
import productLabels from '@/renderer/services/i18n/locales/en-US/login.json';

type AssistantNameSource = Pick<Assistant, 'id' | 'name'> & Partial<Pick<Assistant, 'name_i18n'>>;

export function resolveAssistantName(
  assistant: AssistantNameSource | null | undefined,
  localeKey: string,
  fallback = 'Assistant'
): string {
  if (!assistant) {
    return fallback;
  }

  // The generated native assistant keeps its Core ID; only its UI identity changes.
  if (assistant.id === 'bare:632f31d2') return productLabels.brand;

  const localizedName = assistant.name_i18n?.[localeKey] || assistant.name_i18n?.['en-US'];
  return localizedName?.trim() || assistant.name?.trim() || assistant.id || fallback;
}

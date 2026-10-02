/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IProvider,
  ModelImageInputCapability,
  ModelOpenAiApiMode,
  ModelSettings,
  ModelType,
} from '@/common/config/storage';

/**
 * Capability matching regex patterns
 */
export const CAPABILITY_PATTERNS: Record<ModelType, RegExp> = {
  text: /gpt|claude|gemini|qwen|llama|mistral|deepseek/i,
  vision: /4o|claude-3|gemini-.*-pro|gemini-.*-flash|gemini-2\.0|qwen-vl|llava|vision/i,
  function_calling: /gpt-4|claude-3|gemini|qwen|deepseek/i,
  image_generation: /flux|diffusion|stabilityai|sd-|dall|cogview|janus|midjourney|mj-|imagen/i,
  web_search: /search|perplexity/i,
  reasoning: /o1-|reasoning|think/i,
  embedding: /(?:^text-|embed|bge-|e5-|LLM2Vec|retrieval|uae-|gte-|jina-clip|jina-embeddings|voyage-)/i,
  rerank: /(?:rerank|re-rank|re-ranker|re-ranking|retrieval|retriever)/i,
  excludeFromPrimary: /dall-e|flux|stable-diffusion|midjourney|flash-image|image|embed|rerank/i,
};

/**
 * Explicit exclusion lists (blacklist) for capabilities
 */
export const CAPABILITY_EXCLUSIONS: Record<ModelType, RegExp[]> = {
  text: [],
  vision: [/embed|rerank|dall-e|flux|stable-diffusion/i],
  function_calling: [
    /aqa(?:-[\w-]+)?/i,
    /imagen(?:-[\w-]+)?/i,
    /o1-mini/i,
    /o1-preview/i,
    /gemini-1(?:\\.[\w-]+)?/i,
    /dall-e/i,
    /embed/i,
    /rerank/i,
  ],
  image_generation: [],
  web_search: [],
  reasoning: [],
  embedding: [],
  rerank: [],
  excludeFromPrimary: [],
};

/**
 * Get the lowercase, normalized base model name for matching.
 */
export const getBaseModelName = (modelName: string): string => {
  return modelName
    .toLowerCase()
    .replace(/[^a-z0-9./-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
};

export type ModelOpenAiApiModeChoice = ModelOpenAiApiMode | 'auto';
export type ModelImageInputChoice = ModelImageInputCapability | 'auto';

/** Whether a provider/model protocol can select an OpenAI wire API. */
export const supportsOpenAiApiMode = (platform: string, modelProtocol = 'openai'): boolean => {
  if (platform === 'new-api') return modelProtocol === 'openai';
  return !['anthropic', 'bedrock', 'gemini', 'gemini-vertex-ai'].includes(platform);
};

/** Apply explicit settings to models while keeping automatic values absent on the wire. */
export const updateModelSettings = (
  current: Record<string, ModelSettings> | undefined,
  modelIds: string[],
  imageInput: ModelImageInputChoice,
  openAiApiMode: ModelOpenAiApiModeChoice
): Record<string, ModelSettings> => {
  const next = { ...current };

  for (const modelId of modelIds) {
    if (imageInput === 'auto' && openAiApiMode === 'auto') {
      delete next[modelId];
      continue;
    }

    const settings: ModelSettings = {};
    if (imageInput !== 'auto') settings.image_input = imageInput;
    if (openAiApiMode !== 'auto') settings.openai_api_mode = openAiApiMode;
    next[modelId] = settings;
  }

  return next;
};

/**
 * Check whether a specific model within a provider has a given capability.
 * Returns true (supported), false (excluded), or undefined (unknown).
 */
export const hasSpecificModelCapability = (
  _platformModel: IProvider,
  modelName: string,
  type: ModelType
): boolean | undefined => {
  const baseModelName = getBaseModelName(modelName);
  const exclusions = CAPABILITY_EXCLUSIONS[type];
  const pattern = CAPABILITY_PATTERNS[type];

  const isExcluded = exclusions.some((excludePattern) => excludePattern.test(baseModelName));
  if (isExcluded) return false;

  return pattern.test(baseModelName) ? true : undefined;
};

/** Customer menu policy over configured providers; local fixture IDs remain usable. */
export const getCustomerModelProviders = (providers: IProvider[]): IProvider[] => {
  const supported = new Set([
    'deepseek/deepseek-v4.1-flash',
    'z-ai/glm-5.3',
    'z-ai/glm-5.3-flash',
    'deepseek-v4.1-flash',
    'glm-5.3',
    'glm-5.3-flash',
    'mock-local',
  ]);
  return providers
    .filter((provider) => provider.enabled !== false)
    .flatMap((provider) => {
      const models = provider.models.filter(
        (model) => supported.has(model) && provider.model_enabled?.[model] !== false
      );
      return models.length ? [{ ...provider, models }] : [];
    });
};

export type PromptBudget = { allowed: boolean; usedBytes: number; maxBytes: number };

/** Conservative service admission policy, not a provider tokenizer estimate. */
export const getPromptBudget = (
  input: string,
  model?: Pick<IProvider, 'context_limit'> & { use_model?: string; model?: string },
  attachmentCount = 0,
  priorContextTokens = 0
): PromptBudget => {
  const contexts: Record<string, number> = {
    'deepseek-v4.1-flash': 1_000_000,
    'glm-5.3': 262_144,
    'glm-5.3-flash': 262_124,
  };
  const name = (model?.use_model || model?.model || '').split('/').at(-1) ?? '';
  const configured = model?.context_limit;
  const configuredContext = Number.isSafeInteger(configured) && configured! > 0 ? configured : undefined;
  const context = contexts[name] ?? configuredContext ?? 262_124;
  const effectiveContext = configuredContext ? Math.min(context, configuredContext) : context;
  // One encoded byte consumes one admission unit. Reserve reply capacity and
  // unknown system/tool framing; actual assembled requests are checked by Core.
  const maxBytes = Math.max(
    0,
    Math.min(effectiveContext, 1024 * 1024) -
      Math.min(16_384, Math.floor(effectiveContext / 4)) -
      Math.min(65_536, Math.floor(effectiveContext / 4)) -
      Math.max(0, attachmentCount) * 4096 -
      Math.max(0, priorContextTokens)
  );
  const usedBytes = new TextEncoder().encode(JSON.stringify(input)).byteLength;
  return { allowed: usedBytes <= maxBytes, usedBytes, maxBytes };
};

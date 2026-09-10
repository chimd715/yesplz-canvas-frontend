/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as i18next from 'i18next';

const config = vi.hoisted(() => ({
  whenReady: vi.fn(async () => {}),
  get: vi.fn(() => 'ko-KR'),
  set: vi.fn(async () => {}),
}));
const bridge = vi.hoisted(() => ({
  on: vi.fn<(callback: (event: { language: string }) => Promise<void>) => void>(),
  invoke: vi.fn(async () => {}),
}));

vi.mock('@/common/config/configService', () => ({ configService: config }));
vi.mock('@/common', () => ({
  ipcBridge: { systemSettings: { languageChanged: { on: bridge.on }, changeLanguage: { invoke: bridge.invoke } } },
}));

const electronDescriptor = Object.getOwnPropertyDescriptor(window, 'electronAPI');
const injectedDescriptor = Object.getOwnPropertyDescriptor(window, '__initialLanguage');

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.doMock('i18next', () => ({ ...i18next, default: i18next.createInstance() }));
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined });
  Object.defineProperty(window, '__initialLanguage', { configurable: true, value: 'ko-KR' });
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('ko-KR');
  localStorage.setItem('i18nextLng', 'ko-KR');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock('i18next');
  document.querySelector('meta[name="ai-builder-preview"]')?.remove();
  localStorage.clear();
  document.documentElement.removeAttribute('lang');
  document.documentElement.removeAttribute('dir');
  for (const [key, descriptor] of [
    ['electronAPI', electronDescriptor],
    ['__initialLanguage', injectedDescriptor],
  ] as const) {
    if (descriptor) Object.defineProperty(window, key, descriptor);
    else Reflect.deleteProperty(window, key);
  }
});

async function start(marker: string | null = 'enabled', desktop = false) {
  if (marker !== null) {
    const meta = document.createElement('meta');
    meta.name = 'ai-builder-preview';
    meta.content = marker;
    document.head.append(meta);
  }
  if (desktop) Object.defineProperty(window, 'electronAPI', electronDescriptor!);
  const module = await import('@/renderer/services/i18n');
  await vi.dynamicImportSettled();
  return module;
}

it('starts hosted pages in English despite Korean storage, injected, backend and browser preferences', async () => {
  const write = vi.spyOn(Object.hasOwn(localStorage, 'setItem') ? localStorage : Storage.prototype, 'setItem');
  const { default: i18n, isHostedEnglish } = await start();

  expect([isHostedEnglish, i18n.language, document.documentElement.lang]).toEqual([true, 'en-US', 'en-US']);
  expect([config.whenReady.mock.calls.length, config.set.mock.calls.length, write.mock.calls.length]).toEqual([
    0, 0, 0,
  ]);
  expect(localStorage.getItem('i18nextLng')).toBe('ko-KR');
});

it('ignores backend broadcasts and explicit language changes in hosted pages without persisting them', async () => {
  const { default: i18n, changeLanguage } = await start();
  const write = vi.spyOn(Object.hasOwn(localStorage, 'setItem') ? localStorage : Storage.prototype, 'setItem');
  await bridge.on.mock.calls[0]![0]({ language: 'ko-KR' });
  await changeLanguage('ko-KR');

  expect([i18n.language, document.documentElement.lang]).toEqual(['en-US', 'en-US']);
  expect([config.set.mock.calls.length, bridge.invoke.mock.calls.length, write.mock.calls.length]).toEqual([0, 0, 0]);
  expect(localStorage.getItem('i18nextLng')).toBe('ko-KR');
});

it.each([
  ['unmarked WebUI', null, false],
  ['a nonmatching marker', 'true', false],
  ['desktop with the hosted marker', 'enabled', true],
] as const)('preserves saved preferences and language switching for %s', async (_label, marker, desktop) => {
  const { default: i18n, isHostedEnglish, changeLanguage } = await start(marker, desktop);
  expect([isHostedEnglish, i18n.language]).toEqual([false, 'ko-KR']);

  await bridge.on.mock.calls[0]![0]({ language: 'ja-JP' });
  expect([i18n.language, localStorage.getItem('i18nextLng')]).toEqual(['ja-JP', 'ja-JP']);

  await changeLanguage('en-US');
  expect([i18n.language, localStorage.getItem('i18nextLng'), config.set.mock.calls, bridge.invoke.mock.calls]).toEqual([
    'en-US',
    'en-US',
    [['language', 'en-US']],
    [[{ language: 'en-US' }]],
  ]);
});

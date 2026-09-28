import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { isHistoricalPreviewUrl, openWebBrowserUrl } from '@/renderer/utils/platform';
import WebviewHost from '@/renderer/components/media/WebviewHost';
import {
  resetCurrentConversationForTest,
  setCurrentConversation,
} from '@/renderer/pages/conversation/explorer/currentConversationStore';

vi.mock('@/common/adapter/httpBridge', () => ({ getBaseUrl: () => '' }));
vi.mock('@/common', () => ({ ipcBridge: {} }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.querySelector('meta[name="ai-builder-preview"]')?.remove();
  resetCurrentConversationForTest();
  window.location.hash = '';
});

const project = '11111111-1111-4111-8111-111111111111';
const revision = '22222222-2222-4222-8222-222222222222';
const handoff = `/platform/projects/${project}/revisions/logical/${revision}/preview?embed=1`;
function enableHostedPreview() {
  vi.stubGlobal('electronAPI', undefined);
  const meta = document.createElement('meta');
  meta.name = 'ai-builder-preview';
  meta.content = 'enabled';
  document.head.append(meta);
}

describe('historical preview handoff', () => {
  it('loads the selected revision through the iframe GET without submitting the live conversation form', () => {
    enableHostedPreview();
    window.location.hash = '#/conversation/logical';
    setCurrentConversation('different-active-core');
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
    const external = vi.spyOn(window, 'open').mockImplementation(() => null);
    const url = window.location.origin + handoff;
    const { rerender } = render(React.createElement(WebviewHost, { url }));
    const frame = screen.getByTitle('preview.preview');
    expect(frame).toHaveAttribute('src', url);
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
    fireEvent.click(screen.getByRole('button', { name: 'common.reload' }));
    expect(screen.getByTitle('preview.preview')).not.toBe(frame);
    expect(screen.getByTitle('preview.preview')).toHaveAttribute('src', url);
    const later = url.replace(revision, '33333333-3333-4333-8333-333333333333');
    rerender(React.createElement(WebviewHost, { url: later }));
    expect(screen.getByTitle('preview.preview')).toHaveAttribute('src', later);
    expect(submit).not.toHaveBeenCalled();
    expect(external).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('#/conversation/logical');
  });

  it('accepts only the exact same-origin handoff and never treats a different revision as selected', () => {
    enableHostedPreview();
    expect(isHistoricalPreviewUrl(handoff, revision)).toBe(true);
    for (const value of [
      '/live',
      handoff + '&redirect=https://foreign.example',
      handoff + '#fragment',
      handoff.replace('embed=1', 'embed=0'),
      handoff.replace(revision, 'bad'),
      'https://foreign.example' + handoff,
    ])
      expect(isHistoricalPreviewUrl(value)).toBe(false);
    expect(isHistoricalPreviewUrl(handoff, '33333333-3333-4333-8333-333333333333')).toBe(false);
    document.querySelector('meta[name="ai-builder-preview"]')?.remove();
    expect(isHistoricalPreviewUrl(handoff)).toBe(false);
  });
});

describe('hosted live preview after a version restore', () => {
  it('targets the mounted Core continuation while keeping the logical conversation URL', () => {
    vi.stubGlobal('electronAPI', undefined);
    const meta = document.createElement('meta');
    meta.name = 'ai-builder-preview';
    meta.content = 'enabled';
    document.head.append(meta);
    window.location.hash = '#/conversation/logical';
    setCurrentConversation('active-core');
    let submitted: FormData | undefined;
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(function (this: HTMLFormElement) {
      submitted = new FormData(this);
    });
    expect(openWebBrowserUrl('http://localhost:3000/', 'preview-frame')).toBe(true);
    expect(submit).toHaveBeenCalledOnce();
    expect(submitted?.get('conversationId')).toBe('active-core');
    expect(window.location.hash).toBe('#/conversation/logical');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { openWebBrowserUrl } from '@/renderer/utils/platform';
import {
  resetCurrentConversationForTest,
  setCurrentConversation,
} from '@/renderer/pages/conversation/explorer/currentConversationStore';

vi.mock('@/common/adapter/httpBridge', () => ({ getBaseUrl: () => '' }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.querySelector('meta[name="ai-builder-preview"]')?.remove();
  resetCurrentConversationForTest();
  window.location.hash = '';
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

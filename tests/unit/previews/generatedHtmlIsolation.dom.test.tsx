import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/common', () => ({
  ipcBridge: { fs: { readFile: { invoke: h.read }, getImageBase64: { invoke: h.read } } },
}));
vi.mock('@/renderer/hooks/chat/useTypingAnimation', () => ({
  useTypingAnimation: ({ content }: { content: string }) => ({ displayedContent: content }),
}));
import HTMLRenderer from '@/renderer/pages/conversation/Preview/components/renderers/HTMLRenderer';
import { isolateGeneratedHtml } from '@/renderer/pages/conversation/Preview/generated';
afterEach(cleanup);

describe('static generated HTML isolation', () => {
  it('puts a restrictive policy first and removes scripts, navigation, forms and policy overrides', () => {
    const html = isolateGeneratedHtml(
      `<html><head><base href='/api/'><meta http-equiv='refresh' content='0;url=/api/auth/user'><meta http-equiv='Content-Security-Policy' content="default-src *"><style>h1{color:red}</style></head><body><h1>Report</h1><script>fetch('/api/auth/user')</script><a href='/api/auth/user' target='_top' ping='https://evil.test'>go</a><form action='/api' onsubmit='steal()'><button formaction='/api'>Send</button></form><iframe src='/api'></iframe><a href='#section'>Section</a><img src='data:image/png;base64,AQ=='></body></html>`
    );
    const document = new DOMParser().parseFromString(html, 'text/html');
    expect(document.head.firstElementChild?.getAttribute('http-equiv')).toBe('Content-Security-Policy');
    expect(document.head.firstElementChild?.getAttribute('content')).toContain("script-src 'none'");
    expect(document.head.firstElementChild?.getAttribute('content')).toContain("connect-src 'none'");
    expect(
      document.querySelectorAll('base, script, iframe, [action], [formaction], [onsubmit], [target], [ping]').length
    ).toBe(0);
    expect(document.querySelectorAll('meta[http-equiv]').length).toBe(1);
    expect(document.querySelector('a')?.hasAttribute('href')).toBe(false);
    expect(document.querySelectorAll('a')[1].getAttribute('href')).toBe('#section');
    expect(document.querySelector('style')?.textContent).toContain('color:red');
    expect(document.querySelector('h1')?.textContent).toBe('Report');
  });
  it('uses an empty opaque iframe sandbox and never inlines host files for generated documents', () => {
    const screen = render(
      <HTMLRenderer
        isolated
        content="<link href='private.css'><script src='private.js'></script><h1>Report</h1>"
        file_path='/server/report.html'
        workspace='/server'
      />
    );
    const iframe = screen.container.querySelector('iframe')!;
    expect(iframe.getAttribute('sandbox')).toBe('');
    expect(iframe.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(iframe.getAttribute('srcdoc')).toContain("script-src 'none'");
    expect(h.read).not.toHaveBeenCalled();
  });
});

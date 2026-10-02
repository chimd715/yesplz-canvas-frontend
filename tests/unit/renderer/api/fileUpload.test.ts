/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FileService,
  MAX_ATTACHMENT_SIZE,
  UPLOAD_ABORTED_ERROR,
  uploadFileViaHttp,
} from '@/renderer/services/FileService';
import { PasteService } from '@/renderer/services/PasteService';
import { refreshSession } from '@/common/adapter/sessionRefresh';
import { trackUpload } from '@/renderer/hooks/file/useUploadState';

vi.mock('@/common/adapter/httpBridge', () => ({ getBaseUrl: () => '', resolveCoreCsrfToken: () => 'csrf-fixture' }));
vi.mock('@/common/adapter/sessionRefresh', () => ({ refreshSession: vi.fn() }));
vi.mock('@/renderer/hooks/file/useUploadState', () => ({
  trackUpload: vi.fn(() => ({ onProgress: vi.fn(), finish: vi.fn() })),
}));

type Listener = () => void;
class FakeXhr {
  static requests: FakeXhr[] = [];
  status = 0;
  statusText = '';
  responseText = '';
  timeout = 0;
  url = '';
  headers: Record<string, string> = {};
  body?: FormData;
  upload = { addEventListener: vi.fn() };
  listeners: Record<string, Listener> = {};
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader(key: string, value: string) {
    this.headers[key] = value;
  }
  addEventListener(name: string, listener: Listener) {
    this.listeners[name] = listener;
  }
  send(body: FormData) {
    this.body = body;
    FakeXhr.requests.push(this);
  }
  abort() {
    this.listeners.abort?.();
  }
  respond(status: number, body: unknown = '') {
    this.status = status;
    this.responseText = typeof body === 'string' ? body : JSON.stringify(body);
    this.listeners.load?.();
  }
}

const fileList = (...files: File[]): FileList =>
  Object.assign(files, { item: (i: number) => files[i] ?? null }) as unknown as FileList;

beforeEach(() => {
  vi.clearAllMocks();
  FakeXhr.requests = [];
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
});
afterEach(() => vi.unstubAllGlobals());

describe('customer file upload transport', () => {
  it('sends original browser bytes, name, conversation and CSRF through same origin', async () => {
    const file = new File(['customer data'], 'customer.txt', { type: 'text/plain' });
    const pending = uploadFileViaHttp(file, 'conversation-1');
    const request = FakeXhr.requests[0];
    expect(request.url).toBe('/api/fs/upload');
    expect(request.headers).toEqual({ 'x-csrf-token': 'csrf-fixture' });
    expect(await (request.body!.get('file') as File).text()).toBe('customer data');
    expect(request.body?.get('conversation_id')).toBe('conversation-1');
    request.respond(200, { success: true, data: '/managed/customer.txt' });
    await expect(pending).resolves.toBe('/managed/customer.txt');
  });

  it('rejects an oversized file before sending bytes', async () => {
    const file = new File([], 'large.bin');
    Object.defineProperty(file, 'size', { value: MAX_ATTACHMENT_SIZE + 1 });
    await expect(uploadFileViaHttp(file)).rejects.toThrow('FILE_TOO_LARGE');
    expect(FakeXhr.requests).toHaveLength(0);
  });

  it('refreshes an expired session and retries the same file once', async () => {
    vi.mocked(refreshSession).mockResolvedValue(true);
    const pending = uploadFileViaHttp(new File(['bytes'], 'note.txt'));
    FakeXhr.requests[0].respond(401);
    await vi.waitFor(() => expect(FakeXhr.requests).toHaveLength(2));
    FakeXhr.requests[1].respond(200, { success: true, data: '/managed/note.txt' });
    await expect(pending).resolves.toBe('/managed/note.txt');
    expect(refreshSession).toHaveBeenCalledOnce();
  });

  it('stops after one failed retry without adding an attachment', async () => {
    vi.mocked(refreshSession).mockResolvedValue(true);
    const pending = uploadFileViaHttp(new File(['bytes'], 'note.txt'));
    const rejected = expect(pending).rejects.toThrow('Upload failed: 401');
    FakeXhr.requests[0].respond(401);
    await vi.waitFor(() => expect(FakeXhr.requests).toHaveLength(2));
    FakeXhr.requests[1].respond(401);
    await rejected;
    expect(refreshSession).toHaveBeenCalledOnce();
  });

  it('does not retry when cancellation occurs during session refresh', async () => {
    let finish!: (value: boolean) => void;
    vi.mocked(refreshSession).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const controller = new AbortController();
    const pending = uploadFileViaHttp(new File(['bytes'], 'note.txt'), undefined, undefined, undefined, {
      signal: controller.signal,
    });
    const rejected = expect(pending).rejects.toThrow(UPLOAD_ABORTED_ERROR);
    FakeXhr.requests[0].respond(401);
    controller.abort();
    finish(true);
    await rejected;
    expect(FakeXhr.requests).toHaveLength(1);
  });

  it.each([413, 500])('reports HTTP %i instead of accepting a file', async (status) => {
    const pending = uploadFileViaHttp(new File(['bytes'], 'note.txt'));
    const rejected = expect(pending).rejects.toThrow(status === 413 ? 'FILE_TOO_LARGE' : 'Upload failed: 500');
    FakeXhr.requests[0].respond(status);
    await rejected;
  });

  it('reports a network failure and releases upload state', async () => {
    const pending = FileService.processDroppedFiles(fileList(new File(['bytes'], 'note.txt')));
    const rejected = expect(pending).rejects.toThrow('network error');
    FakeXhr.requests[0].listeners.error();
    await rejected;
    expect(vi.mocked(trackUpload).mock.results[0].value.finish).toHaveBeenCalledOnce();
  });

  it('rejects invalid server response without creating a misleading path', async () => {
    const pending = uploadFileViaHttp(new File(['bytes'], 'note.txt'));
    const rejected = expect(pending).rejects.toThrow('server returned unsuccessful response');
    FakeXhr.requests[0].respond(200, { success: false });
    await rejected;
  });

  it('validates all selected files before starting a batch', async () => {
    const large = new File([], 'large.bin');
    Object.defineProperty(large, 'size', { value: MAX_ATTACHMENT_SIZE + 1 });
    await expect(FileService.processDroppedFiles(fileList(new File(['safe'], 'safe.txt'), large))).rejects.toThrow(
      'FILE_TOO_LARGE'
    );
    expect(FakeXhr.requests).toHaveLength(0);
  });
});

describe('attachment batch cancellation', () => {
  it('stops a multi-file selection on scope cancellation, including files not yet sent', async () => {
    const controller = new AbortController();
    const pending = FileService.processDroppedFiles(
      fileList(new File(['first'], 'first.txt'), new File(['second'], 'second.txt'), new File(['third'], 'third.txt')),
      'first-conversation',
      'sendbox',
      { signal: controller.signal }
    );
    FakeXhr.requests[0].respond(200, { success: true, data: '/managed/first.txt' });
    await vi.waitFor(() => expect(FakeXhr.requests).toHaveLength(2));
    controller.abort();
    await expect(pending).resolves.toEqual([]);
    expect(FakeXhr.requests).toHaveLength(2);
  });

  it('does not start an upload from a selection whose composer was already left', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      FileService.processDroppedFiles(fileList(new File(['bytes'], 'note.txt')), 'old', 'sendbox', {
        signal: controller.signal,
      })
    ).resolves.toEqual([]);
    expect(FakeXhr.requests).toHaveLength(0);
  });

  it('stops a paste selection on scope cancellation and never returns stale files', async () => {
    const controller = new AbortController();
    const added = vi.fn();
    const makeFile = (name: string) => {
      const file = new File(['bytes'], name, { type: 'text/plain' });
      Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode('bytes').buffer });
      return file;
    };
    const event = {
      stopPropagation: vi.fn(),
      clipboardData: { getData: () => '', files: fileList(makeFile('first.txt'), makeFile('second.txt')) },
    } as unknown as ClipboardEvent;
    const pending = PasteService.handlePaste(event, [], added, undefined, 'old', 'sendbox', undefined, {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(FakeXhr.requests).toHaveLength(1));
    controller.abort();
    await expect(pending).resolves.toBe(true);
    expect(added).not.toHaveBeenCalled();
    expect(FakeXhr.requests).toHaveLength(1);
  });
});

describe('cancellation while authentication refresh is pending', () => {
  it('releases an upload immediately without waiting for the refresh response', async () => {
    let finish!: (value: boolean) => void;
    vi.mocked(refreshSession).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const controller = new AbortController();
    const pending = uploadFileViaHttp(new File(['bytes'], 'note.txt'), 'old', undefined, undefined, {
      signal: controller.signal,
    });
    const rejected = expect(pending).rejects.toThrow(UPLOAD_ABORTED_ERROR);
    FakeXhr.requests[0].respond(401);
    controller.abort();
    await rejected;
    expect(FakeXhr.requests).toHaveLength(1);
    finish(true);
    await Promise.resolve();
    expect(FakeXhr.requests).toHaveLength(1);
  });
});

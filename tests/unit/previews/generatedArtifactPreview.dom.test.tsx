import { act, cleanup, render, waitFor } from '@testing-library/react';
import React, { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IConversationArtifact, IGeneratedFileArtifact } from '@/common/adapter/ipcBridge';

const h = vi.hoisted(() => ({
  auth: { status: 'authenticated', user: { id: 'alice' } },
  listeners: new Set<(artifact: IConversationArtifact) => void>(),
  list: vi.fn(),
  read: vi.fn(),
  open: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      listArtifacts: { invoke: h.list },
      artifactStream: {
        on: (listener: (artifact: IConversationArtifact) => void) => {
          h.listeners.add(listener);
          return () => h.listeners.delete(listener);
        },
      },
    },
  },
}));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('@/renderer/utils/file/previewPayload', () => ({ resolvePreviewPayload: h.read }));
vi.mock('@/renderer/pages/conversation/Preview/context', () => ({
  usePreviewContext: () => ({ openPreview: h.open }),
}));
vi.mock('@arco-design/web-react', () => ({ Message: { error: h.error } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import GeneratedArtifactPreview, { isGeneratedArtifact } from '@/renderer/pages/conversation/Preview/generated';

const artifact = (
  id = 'output',
  filename = 'report.html',
  conversation = 'chat-a',
  project = 'project-a'
): IGeneratedFileArtifact => ({
  id,
  conversation_id: conversation,
  kind: 'generated_file',
  status: 'active',
  payload: {
    project_id: project,
    file: { kind: 'project', pe_id: 'workspace-pe', relative_path: filename },
    file_name: filename,
  },
  created_at: 1,
  updated_at: 1,
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const emit = (value: IConversationArtifact) =>
  act(() => {
    h.listeners.forEach((listener) => listener(value));
  });
const payload = {
  content: '<h1>Report</h1>',
  lastModified: 100,
  sizeBytes: 15,
  oversized: false,
  thresholdBytes: 1024,
};

beforeEach(() => {
  vi.clearAllMocks();
  h.auth = { status: 'authenticated', user: { id: 'alice' } };
  h.listeners.clear();
  h.list.mockResolvedValue([]);
  h.read.mockResolvedValue(payload);
});
afterEach(cleanup);

describe('generated document preview', () => {
  it('opens a live validated output through project I/O, without raw paths or tool text', async () => {
    render(<GeneratedArtifactPreview conversationId='chat-a' projectId='project-a' />);
    emit(artifact());
    await waitFor(() => expect(h.open).toHaveBeenCalledTimes(1));
    expect(h.read).toHaveBeenCalledWith(
      { kind: 'project', pe_id: 'workspace-pe', relative_path: 'report.html' },
      'html'
    );
    expect(h.open).toHaveBeenCalledWith(
      payload.content,
      'html',
      expect.objectContaining({ fileRef: artifact().payload.file, generatedArtifact: true, saveIfMatch: 100 }),
      { replace: true, preserveDirty: true }
    );
    expect(h.open.mock.calls[0][2]).not.toHaveProperty('file_path');
    emit(artifact());
    expect(h.read).toHaveBeenCalledTimes(1);
  });
  it('recovers only the latest document and preserves the matching viewer type', async () => {
    h.list.mockResolvedValue([artifact('older', 'older.md'), { ...artifact('latest', 'latest.pdf'), created_at: 5 }]);
    render(<GeneratedArtifactPreview conversationId='chat-a' projectId='project-a' />);
    await waitFor(() => expect(h.open).toHaveBeenCalledTimes(1));
    expect(h.read).toHaveBeenCalledWith(expect.objectContaining({ relative_path: 'latest.pdf' }), 'pdf');
  });
  it('does not replace a newer live document with an older delayed recovery', async () => {
    const recovery = deferred<IConversationArtifact[]>();
    h.list.mockReturnValue(recovery.promise);
    render(<GeneratedArtifactPreview conversationId='chat-a' projectId='project-a' />);
    emit(artifact('live'));
    await waitFor(() => expect(h.open).toHaveBeenCalledTimes(1));
    await act(async () => recovery.resolve([artifact('old', 'old.md')]));
    expect(h.read).toHaveBeenCalledTimes(1);
  });
  it('only opens the newest output when document reads complete out of order', async () => {
    const older = deferred<typeof payload>();
    h.read.mockReturnValueOnce(older.promise).mockResolvedValueOnce({ ...payload, content: 'newest' });
    render(<GeneratedArtifactPreview conversationId='chat-a' projectId='project-a' />);
    emit(artifact('older', 'older.md'));
    emit(artifact('newer', 'newer.md'));
    await waitFor(() => expect(h.open).toHaveBeenCalledTimes(1));
    await act(async () => older.resolve(payload));
    expect(h.open).toHaveBeenCalledTimes(1);
    expect(h.open.mock.calls[0][0]).toBe('newest');
  });
  it('clears asynchronous work across conversations, projects and logout', async () => {
    const pending = deferred<typeof payload>();
    h.read.mockReturnValueOnce(pending.promise);
    const screen = render(<GeneratedArtifactPreview conversationId='chat-a' projectId='project-a' />);
    emit(artifact());
    screen.rerender(<GeneratedArtifactPreview conversationId='chat-b' projectId='project-b' />);
    await act(async () => pending.resolve(payload));
    expect(h.open).not.toHaveBeenCalled();
    emit(artifact('foreign'));
    expect(h.read).toHaveBeenCalledTimes(1);
    h.auth = { status: 'unauthenticated', user: { id: '' } };
    screen.rerender(<GeneratedArtifactPreview conversationId='chat-b' projectId='project-b' />);
    emit(artifact('after-logout', 'file.md', 'chat-b', 'project-b'));
    expect(h.read).toHaveBeenCalledTimes(1);
  });
  it('restarts recovery promptly in StrictMode while stale recovery is pending', async () => {
    const stale = deferred<IConversationArtifact[]>();
    h.list.mockReturnValueOnce(stale.promise).mockResolvedValueOnce([artifact('fresh', 'fresh.md')]);
    render(
      <StrictMode>
        <GeneratedArtifactPreview conversationId='chat-a' projectId='project-a' />
      </StrictMode>
    );
    await waitFor(() => expect(h.open).toHaveBeenCalledTimes(1));
    await act(async () => stale.resolve([artifact('stale')]));
    expect(h.read).toHaveBeenCalledTimes(1);
  });
  it('shows a bounded preview error, then retries on focus after a failed read', async () => {
    h.read.mockRejectedValueOnce(new Error('unavailable'));
    h.list.mockResolvedValue([artifact()]);
    render(<GeneratedArtifactPreview conversationId='chat-a' projectId='project-a' />);
    await waitFor(() => expect(h.error).toHaveBeenCalledTimes(1));
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(h.open).toHaveBeenCalledTimes(1));
  });
  it('does not read anything when artifact recovery rejects for a deleted conversation', async () => {
    h.list.mockRejectedValue(new Error('404'));
    render(<GeneratedArtifactPreview conversationId='chat-a' projectId='project-a' />);
    await act(async () => {});
    expect(h.read).not.toHaveBeenCalled();
    expect(h.open).not.toHaveBeenCalled();
  });
  it('rejects cross-scope, absolute, traversal, local, missing and unsupported references', () => {
    const values = [
      artifact('foreign', 'file.md', 'foreign'),
      artifact('project', 'file.md', 'chat-a', 'foreign'),
      artifact('absolute', '/server/private.html'),
      artifact('traversal', '../private.html'),
      artifact('unsupported', 'code.exe'),
      { ...artifact(), payload: { ...artifact().payload, file: { kind: 'local', path: '/secret.html' } } },
      { ...artifact(), payload: {} },
    ];
    for (const value of values)
      expect(isGeneratedArtifact(value as IConversationArtifact, 'chat-a', 'project-a')).toBe(false);
  });
});

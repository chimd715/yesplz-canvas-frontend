/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Message } from '@arco-design/web-react';
import FileAttachButton from '@/renderer/components/media/FileAttachButton';
import { useAttachEntry } from '@/renderer/components/chat/MobileActionSheet/useAttachEntry';
import { useDragUpload } from '@/renderer/hooks/file/useDragUpload';
import { useOpenFileSelector } from '@/renderer/hooks/file/useOpenFileSelector';
import { ipcBridge } from '@/common';
import { FileService } from '@/renderer/services/FileService';

vi.mock('@/common', () => ({
  ipcBridge: {
    dialog: { showOpen: { invoke: vi.fn().mockResolvedValue([]) } },
    fs: { listAvailableSkills: { invoke: vi.fn().mockResolvedValue([]) } },
  },
}));

const env = vi.hoisted(() => ({ desktop: false, conversationId: 'customer-conversation' }));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => env.desktop }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/renderer/hooks/context/ConversationContext', () => ({
  useConversationContextSafe: () => ({ conversation_id: env.conversationId }),
}));
vi.mock('@/renderer/services/FileService', () => ({
  isSupportedFile: () => true,
  FileService: { processDroppedFiles: vi.fn() },
  uploadErrorKey: () => 'common.fileAttach.failed',
}));
vi.mock('@arco-design/web-react', () => ({
  Button: ({ children, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
  Trigger: ({ children, popup }: { children: React.ReactNode; popup: () => React.ReactNode }) => (
    <>
      {children}
      {popup()}
    </>
  ),
  Message: { error: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  env.desktop = false;
  env.conversationId = 'customer-conversation';
});

const uploaded = [
  { name: 'customer.txt', path: '/managed/customer.txt', size: 5, type: 'text/plain', lastModified: 0 },
];
const files = (file: File) =>
  Object.assign([file], { item: (i: number) => (i === 0 ? file : null) }) as unknown as FileList;
const dragEvent = (types: string[], fileList?: FileList): React.DragEvent =>
  ({
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: { types, files: fileList ?? [], dropEffect: 'none' },
  }) as unknown as React.DragEvent;

describe('browser attachment entry points', () => {
  it('conversation Add files opens the customer device picker without host IPC', () => {
    const hostPicker = vi.fn();
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    render(<FileAttachButton openFileSelector={hostPicker} onLocalFilesAdded={vi.fn()} />);
    fireEvent.click(screen.getByText('common.fileAttach.addFiles'));
    expect(click).toHaveBeenCalledOnce();
    expect(hostPicker).not.toHaveBeenCalled();
    click.mockRestore();
  });

  it('selected file bytes are uploaded into the current conversation', async () => {
    vi.mocked(FileService.processDroppedFiles).mockResolvedValue(uploaded);
    const onFilesAdded = vi.fn();
    render(<FileAttachButton openFileSelector={vi.fn()} onLocalFilesAdded={onFilesAdded} />);
    const file = new File(['bytes'], 'customer.txt');
    const selected = files(file);
    fireEvent.change(screen.getByTestId('aionrs-file-upload-input'), { target: { files: selected } });
    await waitFor(() => expect(onFilesAdded).toHaveBeenCalledWith(uploaded));
    expect(FileService.processDroppedFiles).toHaveBeenCalledWith(selected, 'customer-conversation', 'sendbox', {
      signal: expect.any(AbortSignal),
    });
  });

  it('failed upload displays an error without attaching a server path', async () => {
    vi.mocked(FileService.processDroppedFiles).mockRejectedValue(new Error('transport fixture'));
    const onFilesAdded = vi.fn();
    render(<FileAttachButton openFileSelector={vi.fn()} onLocalFilesAdded={onFilesAdded} />);
    fireEvent.change(screen.getByTestId('aionrs-file-upload-input'), {
      target: { files: files(new File(['bytes'], 'customer.txt')) },
    });
    await waitFor(() => expect(Message.error).toHaveBeenCalledWith('common.fileAttach.failed'));
    expect(onFilesAdded).not.toHaveBeenCalled();
  });

  it('mobile WebUI has one device-upload entry and no host picker entry', () => {
    const hostPicker = vi.fn();
    const { result } = renderHook(() => useAttachEntry({ openFileSelector: hostPicker, onLocalFilesAdded: vi.fn() }));
    expect(result.current.entries.map((entry) => entry.key)).toEqual(['attach']);
    act(() => result.current.entries[0].onClick?.());
    expect(hostPicker).not.toHaveBeenCalled();
  });
});

describe('customer file drag and drop', () => {
  it('uploads dropped bytes and adds managed attachment paths', async () => {
    vi.mocked(FileService.processDroppedFiles).mockResolvedValue(uploaded);
    const added = vi.fn();
    const { result } = renderHook(() =>
      useDragUpload({ conversation_id: 'customer-conversation', onFilesAdded: added })
    );
    const event = dragEvent(['Files'], files(new File(['bytes'], 'customer.txt')));
    await act(async () => {
      await result.current.dragHandlers.onDrop(event);
    });
    expect(added).toHaveBeenCalledWith(uploaded);
    expect(FileService.processDroppedFiles).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'customer.txt' })]),
      'customer-conversation',
      'sendbox',
      { signal: expect.any(AbortSignal) }
    );
  });

  it('does not hijack text drag or show a file-drop highlight', () => {
    const { result } = renderHook(() => useDragUpload({ onFilesAdded: vi.fn() }));
    const event = dragEvent(['text/plain']);
    act(() => result.current.dragHandlers.onDragOver(event));
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(result.current.isFileDragging).toBe(false);
  });

  it('does not flicker while files traverse nested composer children', () => {
    const { result } = renderHook(() => useDragUpload({ onFilesAdded: vi.fn() }));
    const event = dragEvent(['Files']);
    act(() => {
      result.current.dragHandlers.onDragEnter(event);
      result.current.dragHandlers.onDragEnter(event);
      result.current.dragHandlers.onDragLeave(event);
    });
    expect(result.current.isFileDragging).toBe(true);
    act(() => result.current.dragHandlers.onDragLeave(event));
    expect(result.current.isFileDragging).toBe(false);
  });

  it('rejects a dropped directory without uploading an empty file placeholder', async () => {
    const added = vi.fn();
    const { result } = renderHook(() => useDragUpload({ onFilesAdded: added }));
    const event = dragEvent(['Files'], files(new File([], 'folder')));
    Object.defineProperty(event.dataTransfer, 'items', {
      value: [{ webkitGetAsEntry: () => ({ isDirectory: true }) }],
    });
    await act(async () => {
      await result.current.dragHandlers.onDrop(event);
    });
    expect(Message.error).toHaveBeenCalledWith('common.fileAttach.failed');
    expect(FileService.processDroppedFiles).not.toHaveBeenCalled();
    expect(added).not.toHaveBeenCalled();
  });

  it('surfaces failed drops without adding attachments', async () => {
    vi.mocked(FileService.processDroppedFiles).mockRejectedValue(new Error('upload fixture'));
    const added = vi.fn();
    const { result } = renderHook(() => useDragUpload({ onFilesAdded: added }));
    await act(async () => {
      await result.current.dragHandlers.onDrop(dragEvent(['Files'], files(new File(['bytes'], 'customer.txt'))));
    });
    expect(Message.error).toHaveBeenCalledWith('common.fileAttach.failed');
    expect(added).not.toHaveBeenCalled();
  });
});

describe('/open attachment command', () => {
  it('opens a browser-local picker and preserves the upload ref lane', async () => {
    vi.mocked(FileService.processDroppedFiles).mockResolvedValue(uploaded);
    const hostSelected = vi.fn();
    const uploadedSelected = vi.fn();
    const { result } = renderHook(() =>
      useOpenFileSelector({
        onFilesSelected: hostSelected,
        onFilesUploaded: uploadedSelected,
        conversation_id: 'customer-conversation',
      })
    );
    act(() => result.current.onSlashBuiltinCommand('open'));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: files(new File(['bytes'], 'customer.txt')) } });
    await waitFor(() => expect(uploadedSelected).toHaveBeenCalledWith(uploaded));
    expect(hostSelected).not.toHaveBeenCalled();
    expect(ipcBridge.dialog.showOpen.invoke).not.toHaveBeenCalled();
  });

  it('cleans up a cancelled browser picker without uploading', () => {
    const { result } = renderHook(() => useOpenFileSelector({ onFilesSelected: vi.fn(), onFilesUploaded: vi.fn() }));
    act(() => result.current.openFileSelector());
    const input = document.querySelector('input[type="file"]')!;
    fireEvent(input, new Event('cancel'));
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(FileService.processDroppedFiles).not.toHaveBeenCalled();
  });

  it('does not add an upload to a composer that was unmounted', async () => {
    let finish!: (value: typeof uploaded) => void;
    vi.mocked(FileService.processDroppedFiles).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const added = vi.fn();
    const { result, unmount } = renderHook(() =>
      useOpenFileSelector({ onFilesSelected: vi.fn(), onFilesUploaded: added })
    );
    act(() => result.current.openFileSelector());
    const input = document.querySelector('input[type="file"]')!;
    fireEvent.change(input, { target: { files: files(new File(['bytes'], 'customer.txt')) } });
    unmount();
    await act(async () => {
      finish(uploaded);
    });
    expect(added).not.toHaveBeenCalled();
  });

  it('keeps Electron /open on native paths', async () => {
    env.desktop = true;
    vi.mocked(ipcBridge.dialog.showOpen.invoke).mockResolvedValue(['/host/native.txt']);
    const hostSelected = vi.fn();
    const { result } = renderHook(() => useOpenFileSelector({ onFilesSelected: hostSelected }));
    act(() => result.current.onSlashBuiltinCommand('open'));
    await waitFor(() => expect(hostSelected).toHaveBeenCalledWith(['/host/native.txt']));
    expect(FileService.processDroppedFiles).not.toHaveBeenCalled();
  });
});

describe('attachment composer scope', () => {
  it('releases an open /open picker when its conversation changes', () => {
    const selected = vi.fn();
    const { result, rerender } = renderHook(
      ({ conversation_id }) =>
        useOpenFileSelector({ onFilesSelected: vi.fn(), onFilesUploaded: selected, conversation_id }),
      { initialProps: { conversation_id: 'first-conversation' } }
    );
    act(() => result.current.openFileSelector());
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    rerender({ conversation_id: 'second-conversation' });
    expect(input.isConnected).toBe(false);
    expect(input.onchange).toBeNull();
    fireEvent.change(input, { target: { files: files(new File(['bytes'], 'customer.txt')) } });
    expect(FileService.processDroppedFiles).not.toHaveBeenCalled();
    expect(selected).not.toHaveBeenCalled();
  });

  it('aborts pending /open uploads and cannot attach them to a reused composer', async () => {
    let finish!: (value: typeof uploaded) => void;
    vi.mocked(FileService.processDroppedFiles).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const added = vi.fn();
    const { result, rerender } = renderHook(
      ({ conversation_id }) =>
        useOpenFileSelector({ onFilesSelected: vi.fn(), onFilesUploaded: added, conversation_id }),
      { initialProps: { conversation_id: 'first-conversation' } }
    );
    act(() => result.current.openFileSelector());
    const input = document.querySelector('input[type="file"]')!;
    fireEvent.change(input, { target: { files: files(new File(['bytes'], 'customer.txt')) } });
    const signal = vi.mocked(FileService.processDroppedFiles).mock.calls[0][3]!.signal!;
    rerender({ conversation_id: 'second-conversation' });
    expect(signal.aborted).toBe(true);
    await act(async () => {
      finish(uploaded);
    });
    expect(added).not.toHaveBeenCalled();
  });

  it('aborts a pending drop when a conversation component is reused', async () => {
    let finish!: (value: typeof uploaded) => void;
    vi.mocked(FileService.processDroppedFiles).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const added = vi.fn();
    const { result, rerender } = renderHook(
      ({ conversation_id }) => useDragUpload({ onFilesAdded: added, conversation_id }),
      { initialProps: { conversation_id: 'first-conversation' } }
    );
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.dragHandlers.onDrop(dragEvent(['Files'], files(new File(['bytes'], 'customer.txt'))));
    });
    const signal = vi.mocked(FileService.processDroppedFiles).mock.calls[0][3]!.signal!;
    rerender({ conversation_id: 'second-conversation' });
    expect(signal.aborted).toBe(true);
    await act(async () => {
      finish(uploaded);
      await pending;
    });
    expect(added).not.toHaveBeenCalled();
  });

  it('releases the persistent device input and suppresses an old attachment callback', async () => {
    let finish!: (value: typeof uploaded) => void;
    vi.mocked(FileService.processDroppedFiles).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const added = vi.fn();
    const { rerender } = render(<FileAttachButton openFileSelector={vi.fn()} onLocalFilesAdded={added} />);
    const input = screen.getByTestId('aionrs-file-upload-input');
    fireEvent.change(input, { target: { files: files(new File(['bytes'], 'customer.txt')) } });
    const signal = vi.mocked(FileService.processDroppedFiles).mock.calls[0][3]!.signal!;
    env.conversationId = 'next-conversation';
    rerender(<FileAttachButton openFileSelector={vi.fn()} onLocalFilesAdded={added} />);
    expect(screen.getByTestId('aionrs-file-upload-input')).not.toBe(input);
    expect(signal.aborted).toBe(true);
    await act(async () => {
      finish(uploaded);
    });
    expect(added).not.toHaveBeenCalled();
  });
});

describe('React effect replay', () => {
  it('keeps a fresh active upload scope after StrictMode mounts the composer', async () => {
    vi.mocked(FileService.processDroppedFiles).mockResolvedValue(uploaded);
    const added = vi.fn();
    const { result } = renderHook(() => useOpenFileSelector({ onFilesSelected: vi.fn(), onFilesUploaded: added }), {
      wrapper: React.StrictMode,
    });
    act(() => result.current.openFileSelector());
    const input = document.querySelector('input[type="file"]')!;
    fireEvent.change(input, { target: { files: files(new File(['bytes'], 'customer.txt')) } });
    const signal = vi.mocked(FileService.processDroppedFiles).mock.calls[0][3]!.signal!;
    expect(signal.aborted).toBe(false);
    await waitFor(() => expect(added).toHaveBeenCalledWith(uploaded));
  });
});

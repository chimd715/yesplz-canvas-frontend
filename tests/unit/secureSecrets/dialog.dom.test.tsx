import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SecureSecrets from '@/renderer/pages/conversation/platforms/aionrs/SecureSecrets';
import * as client from '@/renderer/pages/conversation/platforms/aionrs/SecureSecrets/client';
const auth = vi.hoisted(() => ({ status: 'authenticated', user: { id: 'owner-a' } }));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@arco-design/web-react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@arco-design/web-react')>()),
  Message: { success: vi.fn() },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/renderer/pages/conversation/platforms/aionrs/SecureSecrets/client', () => ({
  listSecrets: vi.fn(),
  requestSecret: vi.fn(),
  uploadSecret: vi.fn(),
  revokeSecret: vi.fn(),
}));
const pending = { id: 'a'.repeat(43), name: 'GITHUB_TOKEN', service: 'github' as const, state: 'pending' as const };
beforeEach(() => {
  vi.clearAllMocks();
  auth.status = 'authenticated';
  auth.user = { id: 'owner-a' };
  vi.mocked(client.listSecrets).mockReset().mockResolvedValue([]);
  vi.mocked(client.requestSecret).mockReset().mockResolvedValue(pending);
  vi.mocked(client.uploadSecret)
    .mockReset()
    .mockResolvedValue({ ...pending, state: 'stored' });
  vi.mocked(client.revokeSecret).mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe('secure credential modal', () => {
  it('shows a masked input for a model request and disables save until a value exists', async () => {
    vi.mocked(client.listSecrets).mockResolvedValue([pending]);
    render(<SecureSecrets conversationId='chat-a' />);
    const input = await screen.findByTestId('secure-secret-value');
    expect(input).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'common.save' })).toBeDisabled();
  });
  it('clears a cancelled credential before reopening and never posts it', async () => {
    render(<SecureSecrets conversationId='chat-a' />);
    fireEvent.click(screen.getByTestId('secure-secrets-open'));
    fireEvent.change(await screen.findByTestId('secure-secret-value'), { target: { value: 'private-token' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
    fireEvent.click(screen.getByTestId('secure-secrets-open'));
    await waitFor(() => expect(screen.getByTestId('secure-secret-value')).toHaveValue(''));
    expect(client.uploadSecret).not.toHaveBeenCalled();
  });
  it('uploads through the secure client and clears the visible token after successful save', async () => {
    render(<SecureSecrets conversationId='chat-a' />);
    fireEvent.click(screen.getByTestId('secure-secrets-open'));
    fireEvent.change(await screen.findByTestId('secure-secret-value'), { target: { value: 'private-token' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() =>
      expect(client.uploadSecret).toHaveBeenCalledWith('chat-a', pending.id, 'private-token', expect.any(AbortSignal))
    );
    await waitFor(() => expect(screen.queryByTestId('secure-secret-value')).not.toBeInTheDocument());
  });
  it('keeps an entered value bound to its original request when another model request arrives', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const next = { ...pending, id: 'b'.repeat(43), name: 'OTHER_TOKEN' };
    vi.mocked(client.listSecrets).mockResolvedValueOnce([pending]).mockResolvedValue([pending, next]);
    render(<SecureSecrets conversationId='chat-a' />);
    fireEvent.change(await screen.findByTestId('secure-secret-value'), { target: { value: 'original-private-token' } });
    await vi.advanceTimersByTimeAsync(3000);
    expect(screen.getByTestId('secure-secret-name')).toHaveValue('GITHUB_TOKEN');
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() =>
      expect(client.uploadSecret).toHaveBeenCalledWith(
        'chat-a',
        pending.id,
        'original-private-token',
        expect.any(AbortSignal)
      )
    );
  });
  it('shows a translated generic error when upload fails, without exposing backend exception text', async () => {
    vi.mocked(client.uploadSecret).mockRejectedValue(new Error('private-token'));
    render(<SecureSecrets conversationId='chat-a' />);
    fireEvent.click(screen.getByTestId('secure-secrets-open'));
    fireEvent.change(await screen.findByTestId('secure-secret-value'), { target: { value: 'private-token' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    expect(await screen.findByText('conversation.secureSecrets.error')).toBeInTheDocument();
    expect(screen.queryByText('private-token')).not.toBeInTheDocument();
  });
  it('clears an entered credential and old metadata when switching conversations', async () => {
    vi.mocked(client.listSecrets).mockImplementation(async (conversationId) =>
      conversationId === 'chat-a' ? [pending] : []
    );
    const view = render(<SecureSecrets conversationId='chat-a' />);
    fireEvent.change(await screen.findByTestId('secure-secret-value'), { target: { value: 'private-token' } });
    view.rerender(<SecureSecrets conversationId='chat-b' />);
    expect(screen.queryByTestId('secure-secret-value')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('secure-secrets-open'));
    expect(await screen.findByTestId('secure-secret-value')).toHaveValue('');
    expect(screen.getByTestId('secure-secret-name')).toHaveValue('API_TOKEN');
  });
  it('aborts an upload on scope change and ignores a late error in the new conversation', async () => {
    let rejectUpload!: (error: Error) => void;
    vi.mocked(client.uploadSecret).mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectUpload = reject;
        })
    );
    const view = render(<SecureSecrets conversationId='chat-a' />);
    fireEvent.click(screen.getByTestId('secure-secrets-open'));
    fireEvent.change(await screen.findByTestId('secure-secret-value'), { target: { value: 'private-token' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() => expect(client.uploadSecret).toHaveBeenCalledOnce());
    const signal = vi.mocked(client.uploadSecret).mock.calls[0][3]!;
    view.rerender(<SecureSecrets conversationId='chat-b' />);
    expect(signal.aborted).toBe(true);
    fireEvent.click(screen.getByTestId('secure-secrets-open'));
    await act(async () => {
      rejectUpload(new Error('private-token'));
    });
    expect(screen.getByTestId('secure-secret-value')).toHaveValue('');
    expect(screen.queryByText('conversation.secureSecrets.error')).not.toBeInTheDocument();
  });
  it('does not upload after an earlier secret request finishes outside its account scope', async () => {
    let resolveRequest!: (row: client.SecretMetadata) => void;
    vi.mocked(client.requestSecret).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        })
    );
    const view = render(<SecureSecrets conversationId='chat-a' />);
    fireEvent.click(screen.getByTestId('secure-secrets-open'));
    fireEvent.change(await screen.findByTestId('secure-secret-value'), { target: { value: 'private-token' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    auth.user = { id: 'owner-b' };
    view.rerender(<SecureSecrets conversationId='chat-a' />);
    const signal = vi.mocked(client.requestSecret).mock.calls[0][3]!;
    expect(signal.aborted).toBe(true);
    await act(async () => {
      resolveRequest(pending);
    });
    expect(client.uploadSecret).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('secure-secrets-open'));
    expect(await screen.findByTestId('secure-secret-value')).toHaveValue('');
  });
  it('starts one upload for two clicks before the busy state renders, and permits a failed upload retry', async () => {
    vi.mocked(client.uploadSecret).mockRejectedValueOnce(new Error('private-token'));
    render(<SecureSecrets conversationId='chat-a' />);
    fireEvent.click(screen.getByTestId('secure-secrets-open'));
    fireEvent.change(await screen.findByTestId('secure-secret-value'), { target: { value: 'private-token' } });
    const button = screen.getByRole('button', { name: 'common.save' });
    act(() => {
      button.click();
      button.click();
    });
    expect(await screen.findByText('conversation.secureSecrets.error')).toBeInTheDocument();
    expect(client.requestSecret).toHaveBeenCalledOnce();
    expect(client.uploadSecret).toHaveBeenCalledOnce();
    fireEvent.click(button);
    await waitFor(() => expect(client.uploadSecret).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('secure-secret-value')).not.toBeInTheDocument());
  });
  it('clears the password and aborts operations when authentication ends', async () => {
    vi.mocked(client.uploadSecret).mockImplementation(() => new Promise(() => {}));
    const view = render(<SecureSecrets conversationId='chat-a' />);
    fireEvent.click(screen.getByTestId('secure-secrets-open'));
    fireEvent.change(await screen.findByTestId('secure-secret-value'), { target: { value: 'private-token' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() => expect(client.uploadSecret).toHaveBeenCalledOnce());
    auth.status = 'unauthenticated';
    view.rerender(<SecureSecrets conversationId='chat-a' />);
    expect(vi.mocked(client.uploadSecret).mock.calls[0][3]!.aborted).toBe(true);
    expect(screen.queryByTestId('secure-secret-value')).not.toBeInTheDocument();
    expect(screen.queryByTestId('secure-secrets-open')).not.toBeInTheDocument();
  });
  it('ignores a late revoke failure after leaving the conversation', async () => {
    let rejectRevoke!: (error: Error) => void;
    vi.mocked(client.listSecrets).mockImplementation(async (cid) =>
      cid === 'chat-a' ? [{ ...pending, state: 'stored' }] : []
    );
    vi.mocked(client.revokeSecret).mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectRevoke = reject;
        })
    );
    const view = render(<SecureSecrets conversationId='chat-a' />);
    await waitFor(() => expect(client.listSecrets).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByTestId('secure-secrets-open'));
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.secureSecrets.revoke' }));
    view.rerender(<SecureSecrets conversationId='chat-b' />);
    expect(vi.mocked(client.revokeSecret).mock.calls[0][2]!.aborted).toBe(true);
    fireEvent.click(screen.getByTestId('secure-secrets-open'));
    await act(async () => {
      rejectRevoke(new Error('private-token'));
    });
    expect(screen.queryByText('conversation.secureSecrets.error')).not.toBeInTheDocument();
  });
});

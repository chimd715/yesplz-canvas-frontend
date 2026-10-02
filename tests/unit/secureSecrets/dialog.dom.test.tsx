import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SecureSecrets from '@/renderer/pages/conversation/platforms/aionrs/SecureSecrets';
import * as client from '@/renderer/pages/conversation/platforms/aionrs/SecureSecrets/client';
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
  vi.mocked(client.listSecrets).mockResolvedValue([]);
  vi.mocked(client.requestSecret).mockResolvedValue(pending);
  vi.mocked(client.uploadSecret).mockResolvedValue({ ...pending, state: 'stored' });
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
    await waitFor(() => expect(client.uploadSecret).toHaveBeenCalledWith('chat-a', pending.id, 'private-token'));
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
      expect(client.uploadSecret).toHaveBeenCalledWith('chat-a', pending.id, 'original-private-token')
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
});

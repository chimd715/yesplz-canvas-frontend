import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PromptQueuePanel } from '@/renderer/pages/conversation/platforms/aionrs/PromptQueue';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const item = { id: 'head', input: 'Failed prompt', files: [], created_at: 1 };

describe('customer pending prompt panel', () => {
  it('shows the failed head and offers explicit retry/removal without replacing pending prompts', () => {
    const retry = vi.fn();
    const remove = vi.fn();
    render(
      <PromptQueuePanel
        active={{ ...item, status: 'failed' }}
        items={[{ ...item, id: 'next', input: 'Next prompt' }]}
        onRetry={retry}
        onRemove={remove}
        onEdit={vi.fn()}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('conversation.customerQueue.failed');
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'common.delete' })[0]);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('head');
  });

  it('explains uncertain delivery without offering a duplicate retry and protects an existing composer draft', () => {
    render(
      <PromptQueuePanel
        active={{ ...item, status: 'uncertain' }}
        items={[{ ...item, id: 'next', input: 'Next prompt' }]}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
        onEdit={vi.fn()}
        canEdit={false}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('conversation.customerQueue.uncertain');
    expect(screen.queryByRole('button', { name: 'common.retry' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common.edit' })).toBeDisabled();
  });
});

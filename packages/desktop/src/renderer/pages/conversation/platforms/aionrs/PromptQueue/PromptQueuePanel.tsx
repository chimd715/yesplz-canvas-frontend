import type { ConversationCommandQueueItem } from '../../useConversationCommandQueue';
import React from 'react';
import { Button } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { PromptQueueState } from './state';

type Props = PromptQueueState & {
  canEdit?: boolean;
  onRetry: () => void;
  onRemove: (id: string) => void;
  onEdit: (item: ConversationCommandQueueItem) => void;
};

export const PromptQueuePanel = ({ items, active, onRetry, onRemove, onEdit, canEdit = true }: Props) => {
  const { t } = useTranslation();
  if (!items.length && !active) return null;
  return (
    <div className='mb-8px p-8px rd-12px bg-2 text-t-secondary' aria-label={t('conversation.customerQueue.title')}>
      <div className='text-12px mb-4px'>{t('conversation.customerQueue.count', { count: items.length })}</div>
      {active && (
        <div role={active.status === 'sending' ? 'status' : 'alert'}>
          <div className='text-12px'>{t(`conversation.customerQueue.${active.status}`)}</div>
          <div className='flex items-center gap-8px'>
            <span className='truncate flex-1 min-w-0' title={active.input}>
              {active.input}
            </span>
            {active.status === 'failed' && (
              <Button size='mini' onClick={onRetry}>
                {t('common.retry')}
              </Button>
            )}
            {active.status !== 'sending' && (
              <Button size='mini' onClick={() => onRemove(active.id)}>
                {t('common.delete')}
              </Button>
            )}
          </div>
        </div>
      )}
      {items.map((item) => (
        <div key={item.id} className='flex items-center gap-8px'>
          <span className='truncate flex-1 min-w-0' title={item.input}>
            {item.input}
          </span>
          {item.files.length > 0 && (
            <span className='text-12px'>{t('conversation.commandQueue.files', { count: item.files.length })}</span>
          )}
          <Button size='mini' disabled={!canEdit} onClick={() => onEdit(item)}>
            {t('common.edit')}
          </Button>
          <Button size='mini' onClick={() => onRemove(item.id)}>
            {t('common.delete')}
          </Button>
        </div>
      ))}
    </div>
  );
};

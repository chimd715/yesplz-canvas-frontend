import { Button, Spin } from '@arco-design/web-react';
import React, { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWRInfinite from 'swr/infinite';
import MarkdownView from '@/renderer/components/Markdown';
import {
  fetchRevertedMessages,
  historicalMessageText,
  versionsPath,
  type HistoryPage,
  type RevertedGroup,
} from './api';
import { useVersionHistory } from './context';
import { VersionCard } from './VersionCard';
import styles from './VersionHistory.module.css';

const RevertedMessages: React.FC<{ group: RevertedGroup }> = ({ group }) => {
  const { t } = useTranslation();
  const history = useVersionHistory();
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const { data, error, isValidating, size, setSize, mutate } = useSWRInfinite<HistoryPage>(
    (index, previous: HistoryPage | null) => {
      if (
        !expanded ||
        !history?.logicalConversationId ||
        (index > 0 && (!previous?.has_more_before || !previous.oldest_cursor))
      )
        return null;
      const base = `${versionsPath(history.logicalConversationId)}/reverted/${encodeURIComponent(group.id)}/messages`;
      return index > 0 ? `${base}?before=${encodeURIComponent(previous!.oldest_cursor!)}` : base;
    },
    fetchRevertedMessages,
    { shouldRetryOnError: false, revalidateOnFocus: false }
  );
  const messages =
    data
      ?.toReversed()
      .flatMap((page) => page.items)
      .filter((message) => !message.hidden) ?? [];
  const versions =
    history?.data?.versions.filter((version) =>
      group.revisionIds
        ? group.revisionIds.includes(version.id)
        : version.sourceConversationId === group.sourceConversationId &&
          messages.some((message) => message.id === version.messageId)
    ) ?? [];
  return (
    <section className={styles.reverted}>
      <div className={styles.revertedHeader}>
        <span>{t('conversation.versions.revertedMessages')}</span>
        <Button
          type='text'
          size='small'
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((value) => !value)}
        >
          {t(expanded ? 'conversation.versions.hide' : 'conversation.versions.show')}
        </Button>
      </div>
      {expanded && (
        <div id={contentId}>
          {error && (
            <div role='alert' className={styles.error}>
              {t('conversation.versions.historyUnavailable')}
              <Button size='small' loading={isValidating} onClick={() => void mutate()}>
                {t('common.retry')}
              </Button>
            </div>
          )}
          {isValidating && !data && <Spin aria-label={t('common.loading')} />}
          {data?.at(-1)?.has_more_before && (
            <Button size='small' loading={isValidating} onClick={() => void setSize(size + 1)}>
              {t('conversation.versions.loadEarlier')}
            </Button>
          )}
          <div className={styles.historicalText}>
            {messages.map((message) => (
              <React.Fragment key={message.id}>
                <div className={message.position === 'right' ? styles.userMessage : styles.message}>
                  {message.type === 'text' ? (
                    <MarkdownView allowHtml={false} onLocalFileLink={() => undefined}>
                      {historicalMessageText(message.content)}
                    </MarkdownView>
                  ) : (
                    <pre className={styles.toolMessage}>{historicalMessageText(message.content)}</pre>
                  )}
                </div>
                {versions
                  .filter((version) => version.messageId === message.id)
                  .map((version) => (
                    <VersionCard key={version.id} version={version} />
                  ))}
              </React.Fragment>
            ))}
          </div>
          {versions
            .filter((version) => !messages.some((message) => message.id === version.messageId))
            .map((version) => (
              <VersionCard key={version.id} version={version} />
            ))}
        </div>
      )}
    </section>
  );
};
export default RevertedMessages;

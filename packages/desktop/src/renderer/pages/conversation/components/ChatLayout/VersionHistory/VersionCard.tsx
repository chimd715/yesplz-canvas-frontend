import { Button } from '@arco-design/web-react';
import { History, PreviewOpen } from '@icon-park/react';
import React, { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview';
import { useVersionHistory } from './context';
import { versionPreviewUrl, type SavedVersion } from './api';
import RevertedMessages from './RevertedMessages';
import styles from './VersionHistory.module.css';

export const VersionCard: React.FC<{ version: SavedVersion }> = ({ version }) => {
  const { t } = useTranslation();
  const history = useVersionHistory();
  const { openPreview } = usePreviewContext();
  const [details, setDetails] = useState(false);
  const detailsId = useId();
  if (!history?.data) return null;
  const number = history.data.versions.findIndex((item) => item.id === version.id) + 1;
  const previewUrl = versionPreviewUrl(version);
  const active = history.data.activeRevisionId === version.id;
  return (
    <section className={styles.card} aria-label={t('conversation.versions.version', { number })}>
      <div className={styles.heading}>
        <History size={17} aria-hidden />
        <div className={styles.title}>{version.label || t('conversation.versions.version', { number })}</div>
      </div>
      <div className={styles.meta}>
        <span>{t('conversation.versions.version', { number })}</span>
        <span>{t(`conversation.versions.status.${version.status}`)}</span>
        {active && <span>{t('conversation.versions.current')}</span>}
        {version.published && <span>{t('conversation.versions.published')}</span>}
      </div>
      <div className={styles.actions}>
        <Button
          size='small'
          type='text'
          aria-expanded={details}
          aria-controls={detailsId}
          onClick={() => setDetails((value) => !value)}
        >
          {t('conversation.versions.details')}
        </Button>
        <Button
          size='small'
          icon={<PreviewOpen size={15} />}
          disabled={!previewUrl}
          onClick={() => {
            if (!previewUrl) return;
            history.selectVersion(version.id);
            openPreview(previewUrl, 'url', { title: t('conversation.versions.version', { number }), editable: false });
          }}
        >
          {t('preview.preview')}
        </Button>
      </div>
      {details && (
        <div id={detailsId} className={styles.details}>
          <time dateTime={new Date(version.createdAt).toISOString()}>
            {new Date(version.createdAt).toLocaleString()}
          </time>
          {!previewUrl && <p>{t('conversation.versions.previewUnavailable')}</p>}
          <p>{t('conversation.versions.restoreDescription')}</p>
          <Button
            size='small'
            disabled={active || !!history.error || history.restoring || version.status === 'building'}
            loading={history.restoring}
            onClick={() => void history.restore(version.id)}
          >
            {t('conversation.versions.revert')}
          </Button>
        </div>
      )}
    </section>
  );
};

/** Keep saved cards beside their original turn, including grouped tool messages. */
export const VersionTimelineItems: React.FC<{ messageIds?: string[]; visibleMessageIds?: string[] }> = ({
  messageIds,
  visibleMessageIds = [],
}) => {
  const history = useVersionHistory();
  if (!history?.data) return null;
  const { data } = history;
  const matches = (anchor: string | undefined): boolean =>
    messageIds ? !!anchor && messageIds.includes(anchor) : !anchor || !visibleMessageIds.includes(anchor);
  return (
    <>
      {data.versions
        .filter((version) => {
          const archived = data.reverted.some((group) =>
            group.revisionIds
              ? group.revisionIds.includes(version.id)
              : group.sourceConversationId === version.sourceConversationId
          );
          const anchor =
            version.activeMessageId ??
            (version.sourceConversationId === data.activeCoreConversationId ? version.messageId : undefined);
          return (!archived || !!version.activeMessageId) && matches(anchor);
        })
        .map((version) => (
          <VersionCard key={version.id} version={version} />
        ))}
      {data.reverted
        .filter((group) => matches(group.afterActiveMessageId))
        .map((group) => (
          <RevertedMessages key={group.id} group={group} />
        ))}
    </>
  );
};

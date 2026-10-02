import { Button } from '@arco-design/web-react';
import { History, PreviewOpen } from '@icon-park/react';
import React, { useId, useState, useSyncExternalStore } from 'react';
import {
  getActiveNativeRuntimeContext,
  getBuilderWorkspace,
  isNativeRuntimeActive,
  nativeRuntimeActivationEpoch,
  subscribeNativeRuntimeActivation,
} from '@/common/adapter/httpBridge';
import { isHostedPreviewUrl } from '@/renderer/utils/platform';
import { useTranslation } from 'react-i18next';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview';
import { useVersionHistory } from './context';
import { isSourceVersion, versionPreviewUrl, type SavedVersion, type SourceVersion } from './api';
import RevertedMessages from './RevertedMessages';
import styles from './VersionHistory.module.css';

export const VersionCard: React.FC<{ version: SavedVersion | SourceVersion }> = ({ version }) => {
  const { t } = useTranslation();
  const history = useVersionHistory();
  const { openPreview } = usePreviewContext();
  useSyncExternalStore(subscribeNativeRuntimeActivation, nativeRuntimeActivationEpoch);
  const [details, setDetails] = useState(false);
  const detailsId = useId();
  const source = isSourceVersion(version);
  if (!history || (!source && !history.data)) return null;
  const number =
    ((source ? history.sourceHistory?.versions : history.data?.versions)?.findIndex((item) => item.id === version.id) ??
      -1) + 1;
  const previewUrl = versionPreviewUrl(version);
  const active = source
    ? history.sourceHistory?.latestSavedVersionId === version.id
    : history.data?.activeRevisionId === version.id;
  const currentCoreId = history.data?.activeCoreConversationId ?? history.logicalConversationId;
  // Loopback is the existing live-preview handoff marker, not a chosen listener port.
  // WebviewHost asks the gateway to resolve this conversation's owned VM listener.
  const livePreview =
    source &&
    active &&
    history.continuationResolved &&
    isNativeRuntimeActive() &&
    isHostedPreviewUrl('http://localhost/') &&
    (!getBuilderWorkspace() || getActiveNativeRuntimeContext()?.coreId === currentCoreId);
  const selected = source
    ? history.selection.kind === 'source' && history.selection.sourceVersionId === version.id
    : history.selectedVersion?.id === version.id;
  const published = source ? history.sourceHistory?.publishedSourceVersionId === version.id : version.published;
  return (
    <section
      className={`${styles.card}${selected ? ` ${styles.selected}` : ''}`}
      aria-label={t(source ? 'conversation.versions.sourceVersion' : 'conversation.versions.version', { number })}
    >
      <div className={styles.heading}>
        <History size={17} aria-hidden />
        <div className={styles.title}>
          {source
            ? t('conversation.versions.sourceSummary')
            : version.label || t('conversation.versions.version', { number })}
        </div>
      </div>
      <div className={styles.meta}>
        <span>{t('conversation.versions.version', { number })}</span>
        <span>
          {source ? t('conversation.versions.status.saved') : t(`conversation.versions.status.${version.status}`)}
        </span>
        {active && (
          <span className={styles.state}>
            {t(source ? 'conversation.versions.latestSaved' : 'conversation.versions.current')}
          </span>
        )}
        {selected && <span className={styles.state}>{t('conversation.versions.selected')}</span>}
        {published && <span className={styles.state}>{t('conversation.versions.published')}</span>}
      </div>
      <div className={styles.actions}>
        <Button
          size='small'
          aria-expanded={details}
          aria-controls={detailsId}
          onClick={() => setDetails((value) => !value)}
        >
          {t('conversation.versions.details')}
        </Button>
        <Button
          size='small'
          icon={<PreviewOpen size={15} />}
          disabled={!livePreview && !previewUrl}
          onClick={() => {
            if (livePreview) {
              history.selectCurrent();
              openPreview('http://localhost/', 'url', {
                title: t('conversation.versions.currentWork'),
                editable: false,
              });
              return;
            }
            if (!previewUrl) return;
            if (source) history.selectSourceVersion(version.id);
            else history.selectVersion(version.id);
            openPreview(previewUrl, 'url', {
              title: t('conversation.versions.version', { number }),
              editable: false,
            });
          }}
        >
          {t('preview.preview')}
        </Button>
      </div>
      {source && version.sourceKind === 'node' && !livePreview && (
        <p className={styles.meta}>{t('conversation.versions.dynamicPreviewUnavailable')}</p>
      )}
      {source && version.sourceKind === 'static' && !previewUrl && !livePreview && (
        <p className={styles.meta}>{t('conversation.versions.previewUnavailable')}</p>
      )}
      {details && (
        <div id={detailsId} className={styles.details}>
          <time dateTime={new Date(version.createdAt).toISOString()}>
            {new Date(version.createdAt).toLocaleString()}
          </time>
          {!previewUrl && <p>{t('conversation.versions.previewUnavailable')}</p>}
          {source ? (
            <>
              <p>{t('conversation.versions.sourceDescription')}</p>
              <div className={styles.identity}>
                {t('conversation.versions.versionId')}: {version.id}
              </div>
              <Button
                size='small'
                aria-pressed={selected}
                disabled={history.saving || !!history.sourceError}
                onClick={() => history.selectSourceVersion(version.id)}
              >
                {t('conversation.versions.select')}
              </Button>
            </>
          ) : (
            <>
              <p>{t('conversation.versions.restoreDescription')}</p>
              <Button
                size='small'
                disabled={active || !!history.error || history.restoring || version.status === 'building'}
                loading={history.restoring}
                onClick={() => void history.restore(version.id)}
              >
                {t('conversation.versions.revert')}
              </Button>
            </>
          )}
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
  if (!history) return null;
  const { data, sourceHistory } = history;
  const matches = (anchor: string | undefined): boolean =>
    messageIds ? !!anchor && messageIds.includes(anchor) : !anchor || !visibleMessageIds.includes(anchor);
  return (
    <>
      {data?.versions
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
      {data?.reverted
        .filter((group) => matches(group.afterActiveMessageId))
        .map((group) => (
          <RevertedMessages key={group.id} group={group} />
        ))}
      {sourceHistory?.cards
        .filter((card) => matches(card.messageId))
        .map((card) => {
          const version = sourceHistory.versions.find((item) => item.id === card.sourceVersionId);
          return version ? <VersionCard key={`${card.messageId}/${version.id}`} version={version} /> : null;
        })}
      {!messageIds &&
        sourceHistory?.versions
          .filter((version) => !sourceHistory.cards.some((card) => card.sourceVersionId === version.id))
          .map((version) => <VersionCard key={version.id} version={version} />)}
      {!messageIds && (history.saving || history.snapshotError) && (
        <div className={styles.notice} role={history.snapshotError ? 'alert' : 'status'} aria-live='polite'>
          {history.saving ? <SnapshotText state='saving' /> : <SnapshotText state={history.snapshotError!} />}
        </div>
      )}
    </>
  );
};

const SnapshotText: React.FC<{ state: 'saving' | 'busy' | 'missing' | 'unavailable' }> = ({ state }) => {
  const { t } = useTranslation();
  return <>{t(`conversation.versions.snapshot.${state}`)}</>;
};

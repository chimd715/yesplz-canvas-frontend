import { isElectronDesktop } from '@/renderer/utils/platform';
import { copyText } from '@/renderer/utils/ui/clipboard';
import { Button, Input, Link, Message, Popover } from '@arco-design/web-react';
import { Copy, Rocket } from '@icon-park/react';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import styles from './PublishButton.module.css';

type Phase = 'unconfigured' | 'provisioning' | 'ready' | 'publishing' | 'failed' | 'interrupted';
type PublishingStatus = {
  projectId: string;
  phase: Phase;
  connected: boolean;
  workspaceMatches: boolean;
  conversationId?: string;
  history: { url: string; conversationId?: string }[];
};
const phases: Phase[] = ['unconfigured', 'provisioning', 'ready', 'publishing', 'failed', 'interrupted'];
const pending = (phase?: Phase) => phase === 'provisioning' || phase === 'publishing';
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

function publicUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch {
    // An invalid public URL is never rendered as a link.
  }
}

async function readStatus(response: Response): Promise<PublishingStatus> {
  if (!response.ok) throw new Error('Publishing status unavailable');
  const data: unknown = await response.json();
  if (
    !object(data) ||
    typeof data.projectId !== 'string' ||
    !phases.includes(data.phase as Phase) ||
    typeof data.connected !== 'boolean' ||
    typeof data.workspaceMatches !== 'boolean' ||
    !Array.isArray(data.history)
  ) {
    throw new Error('Invalid publishing status');
  }
  return {
    projectId: data.projectId,
    phase: data.phase as Phase,
    connected: data.connected,
    workspaceMatches: data.workspaceMatches,
    conversationId: typeof data.conversationId === 'string' ? data.conversationId : undefined,
    history: data.history.flatMap((entry: unknown) => {
      if (!object(entry)) return [];
      const url = publicUrl(entry.url);
      return url
        ? [{ url, conversationId: typeof entry.conversationId === 'string' ? entry.conversationId : undefined }]
        : [];
    }),
  };
}

const fetchStatus = async (url: string): Promise<PublishingStatus> =>
  readStatus(
    await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    })
  );

/** Publishing is available only when the project gateway confirms this conversation's source. */
const PublishButton: React.FC<{ conversationId: string }> = ({ conversationId }) => {
  const { t } = useTranslation();
  const enabled = !isElectronDesktop() && /^https?:$/.test(window.location.protocol);
  const { data, error, isValidating, mutate } = useSWR<PublishingStatus>(
    enabled ? `/api/platform/publishing?conversationId=${encodeURIComponent(conversationId)}` : null,
    fetchStatus,
    {
      shouldRetryOnError: false,
      keepPreviousData: false,
      refreshInterval: (status) => (pending(status?.phase) ? 3000 : 0),
    }
  );
  const [visible, setVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [publishFailed, setPublishFailed] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    setVisible(false);
    setSubmitting(false);
    setPublishFailed(false);
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [conversationId]);

  // Plain Aion and Electron have no publishing capability; do not add an irrelevant control.
  if (!enabled || !data) return null;
  const busy = submitting || pending(data.phase);
  const url = data.history
    .filter((entry) => (entry.conversationId ?? data.conversationId) === conversationId)
    .at(-1)?.url;
  const unavailable = !data.connected || data.phase === 'unconfigured';
  const canPublish = data.workspaceMatches && !unavailable && !busy && !error && !isValidating;

  const publish = async () => {
    if (!canPublish || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setSubmitting(true);
    setPublishFailed(false);
    try {
      const next = await readStatus(
        await fetch('/api/platform/publishing/publish', {
          method: 'POST',
          credentials: 'same-origin',
          redirect: 'error',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        })
      );
      if (!controller.signal.aborted) await mutate(next, { revalidate: false });
    } catch {
      if (!controller.signal.aborted) {
        setPublishFailed(true);
        // The server may have accepted a request before its response was lost. Reconcile before retrying.
        void mutate();
      }
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setSubmitting(false);
    }
  };

  const content = (
    <div className={styles.panel}>
      <div className='text-16px font-600 text-t-primary'>{t('conversation.publishing.title')}</div>
      <div className='flex items-center justify-between gap-16px text-13px' role='status' aria-live='polite'>
        <span className='text-t-secondary'>{t('common.status')}</span>
        <span className='text-t-primary'>{t(`conversation.publishing.phase.${data.phase}`)}</span>
      </div>
      {!data.workspaceMatches && <div className='text-13px text-t-secondary'>{t('conversation.publishing.noApp')}</div>}
      {unavailable && <div className='text-13px text-t-secondary'>{t('conversation.publishing.notReady')}</div>}
      {data.phase === 'failed' && (
        <div role='alert' className='text-13px text-danger'>
          {t('conversation.publishing.failed')}
        </div>
      )}
      {publishFailed && !busy && data.phase !== 'failed' && (
        <div role='alert' className='text-13px text-danger'>
          {t('conversation.publishing.requestFailed')}
        </div>
      )}
      {error && (
        <div role='alert' className='flex items-center justify-between gap-12px text-13px text-danger'>
          <span>{t('conversation.publishing.unavailable')}</span>
          <Button size='mini' onClick={() => void mutate()} loading={isValidating}>
            {t('common.retry')}
          </Button>
        </div>
      )}
      {url && (
        <div className='flex flex-col gap-8px'>
          <div className='text-12px text-t-secondary'>{t('conversation.publishing.publicUrl')}</div>
          <Input value={url} readOnly aria-label={t('conversation.publishing.publicUrl')} />
          <div className='flex items-center justify-between gap-12px'>
            <Link href={url} target='_blank' rel='noopener noreferrer'>
              {t('conversation.publishing.openApp')}
            </Link>
            <Button
              size='small'
              icon={<Copy size={14} />}
              onClick={() => {
                void copyText(url)
                  .then(() => Message.success(t('common.copySuccess')))
                  .catch(() => Message.error(t('common.copyFailed')));
              }}
            >
              {t('conversation.publishing.copyLink')}
            </Button>
          </div>
        </div>
      )}
      <Button className={styles.primary} long disabled={!canPublish} loading={busy} onClick={() => void publish()}>
        {t(
          busy
            ? 'conversation.publishing.inProgress'
            : url
              ? 'conversation.publishing.publishChanges'
              : 'conversation.publishing.publishApp'
        )}
      </Button>
    </div>
  );

  return (
    <Popover
      content={content}
      trigger='click'
      position='br'
      popupVisible={visible}
      onVisibleChange={(next) => {
        setVisible(next);
        if (next) void mutate();
      }}
    >
      <Button className={styles.primary} icon={<Rocket size={16} fill='currentColor' />} aria-expanded={visible}>
        {t('conversation.publishing.publish')}
      </Button>
    </Popover>
  );
};

export default PublishButton;

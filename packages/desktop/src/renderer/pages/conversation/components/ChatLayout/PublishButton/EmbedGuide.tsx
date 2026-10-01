import { copyText } from '@/renderer/utils/ui/clipboard';
import { Button, Input, Link, Message, Tabs } from '@arco-design/web-react';
import { Copy } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './PublishButton.module.css';

export type EmbedNotice = 'publishFirst' | 'publishAgain' | 'replaced' | 'pending' | 'checking' | 'unavailable';

function installationCode(code: string | undefined, platform: string): string | undefined {
  if (!code) return code;
  const document = new DOMParser().parseFromString(code, 'text/html');
  const widget = document.querySelector('[data-shopify-bindings]');
  const scripts = [...document.querySelectorAll('script[src]')];
  if (!widget?.localName.includes('-') || !scripts.length) return code;
  let bindings: unknown;
  try {
    bindings = JSON.parse(widget.getAttribute('data-shopify-bindings') ?? '');
  } catch {
    return code;
  }
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) return code;
  const entries = Object.entries(bindings);
  if (
    !entries.length ||
    entries.some(
      ([name, path]) =>
        !/^[a-z][a-z0-9-]*$/.test(name) ||
        name.startsWith('on') ||
        name === 'data-shopify-bindings' ||
        !widget.hasAttribute(name) ||
        typeof path !== 'string' ||
        !/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(path)
    )
  )
    return code;
  widget.removeAttribute('data-shopify-bindings');
  if (platform === 'shopify') {
    for (const [name, path] of entries) widget.setAttribute(name, `{{ ${String(path)} | escape }}`);
  }
  return [...scripts.map((script) => script.outerHTML), widget.outerHTML].join('\n');
}

/** Installation help for the published artifact; opening this panel never deploys or modifies a shop. */
const EmbedGuide: React.FC<{ code?: string; notice?: EmbedNotice; onRetry: () => void; retrying: boolean }> = ({
  code,
  notice,
  onRetry,
  retrying,
}) => {
  const { t } = useTranslation();
  const [platform, setPlatform] = useState('shopify');
  const displayedCode = installationCode(code, platform);
  return (
    <div className={styles.embedPanel}>
      <div className='text-16px font-600 text-t-primary'>{t('conversation.embedding.title')}</div>
      <Tabs activeTab={platform} onChange={setPlatform} size='small'>
        <Tabs.TabPane key='shopify' title={t('conversation.embedding.shopify')}>
          <ol className={styles.instructions}>
            <li>{t('conversation.embedding.shopifyOpen')}</li>
            <li>{t('conversation.embedding.shopifyAdd')}</li>
            <li>{t('conversation.embedding.shopifySave')}</li>
          </ol>
          <p className='text-12px text-t-secondary'>{t('conversation.embedding.shopifyNote')}</p>
          <Link
            href='https://help.shopify.com/en/manual/online-store/themes/customizing-themes/theme-editor/customizing-sections'
            target='_blank'
            rel='noopener noreferrer'
          >
            {t('conversation.embedding.shopifyHelp')}
          </Link>
        </Tabs.TabPane>
        <Tabs.TabPane key='html' title={t('conversation.embedding.others')}>
          <ol className={styles.instructions}>
            <li>{t('conversation.embedding.htmlOpen')}</li>
            <li>{t('conversation.embedding.htmlPaste')}</li>
            <li>{t('conversation.embedding.htmlSave')}</li>
          </ol>
          <p className='text-12px text-t-secondary'>{t('conversation.embedding.htmlNote')}</p>
        </Tabs.TabPane>
      </Tabs>
      {displayedCode ? (
        <div className='flex flex-col gap-12px'>
          <Input.TextArea
            className={styles.embedCode}
            value={displayedCode}
            readOnly
            spellCheck={false}
            autoSize={{ minRows: 4, maxRows: 7 }}
            aria-label={t('conversation.embedding.installationCode')}
          />
          <Button
            long
            className={styles.primary}
            icon={<Copy size={14} />}
            onClick={() => {
              void copyText(displayedCode)
                .then(() => Message.success(t('common.copySuccess')))
                .catch(() => Message.error(t('common.copyFailed')));
            }}
          >
            {t('conversation.embedding.copyCode')}
          </Button>
          <p className='m-0 text-12px text-t-secondary'>{t('conversation.embedding.publishedNote')}</p>
        </div>
      ) : (
        <div className='flex flex-col gap-8px text-13px text-t-secondary' role='status' aria-live='polite'>
          <span>{t(`conversation.embedding.${notice ?? 'publishFirst'}`)}</span>
          {notice === 'unavailable' && (
            <Button size='small' onClick={onRetry} loading={retrying}>
              {t('common.retry')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

export default EmbedGuide;

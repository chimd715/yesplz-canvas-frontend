import React, { useEffect, useState } from 'react';
import { Button } from '@arco-design/web-react';
import { Shop, ArrowLeft, Right } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import SettingsPageWrapper from '../components/SettingsPageWrapper';
import SettingsPageHeader from '../components/SettingsPageHeader';

export const ConnectorCatalog: React.FC = () => {
  const { t } = useTranslation();
  const [showShopify, setShowShopify] = useState(false);
  const [connection, setConnection] = useState<{ available: boolean; connected: boolean; shop?: string }>({
    available: false,
    connected: false,
  });
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/platform/connectors/shopify', { signal: controller.signal, credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Connection status unavailable');
        const data = await response.json();
        setConnection({
          available: data.available === true,
          connected: data.connected === true,
          shop: typeof data.shop === 'string' ? data.shop : undefined,
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  const connect = async () => {
    setConnecting(true);
    setError(false);
    try {
      const path = '/' + window.location.hash;
      const returnPath = /^\/#\/(guid|settings\/plugins|conversation\/[A-Za-z0-9_-]{1,100})$/.test(path)
        ? path
        : '/#/guid';
      const response = await fetch('/api/platform/connectors/shopify', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnPath }),
      });
      if (!response.ok) throw new Error('Connection unavailable');
      const data = await response.json();
      const target = new URL(data.url);
      if (!['http:', 'https:'].includes(target.protocol) || target.pathname !== '/auth/shopify/start')
        throw new Error('Invalid connection URL');
      window.location.assign(target.href);
    } catch {
      setError(true);
      setConnecting(false);
    }
  };
  const status = loading
    ? t('common.loading')
    : connection.connected
      ? t('settings.plugins.shopify.connected', { shop: connection.shop })
      : connection.available
        ? t('settings.plugins.shopify.ready')
        : t('settings.plugins.shopify.pending');
  return (
    <div className='flex flex-col gap-16px'>
      {error && (
        <p role='alert' className='text-13px text-t-secondary'>
          {t('settings.plugins.shopify.error')}
        </p>
      )}
      {showShopify ? (
        <div className='flex flex-col gap-20px py-8px'>
          <Button
            type='text'
            className='self-start !px-0'
            icon={<ArrowLeft size={16} />}
            onClick={() => setShowShopify(false)}
          >
            {t('settings.plugins.back')}
          </Button>
          <div className='flex items-start gap-16px'>
            <Shop size={32} className='shrink-0 text-t-secondary' />
            <div className='min-w-0'>
              <h2 className='m-0 text-20px font-600 text-t-primary'>{t('settings.plugins.shopify.name')}</h2>
              <p className='mt-8px mb-0 text-14px text-t-secondary'>{t('settings.plugins.shopify.description')}</p>
            </div>
          </div>
          <div className='border-t border-border-2 pt-16px'>
            <h3 className='m-0 text-14px font-600 text-t-primary'>{t('settings.plugins.shopify.connection')}</h3>
            <p className='mt-8px mb-0 text-13px text-t-secondary'>{t('settings.plugins.shopify.flow')}</p>
          </div>
          <div>
            <h3 className='m-0 text-14px font-600 text-t-primary'>{t('settings.plugins.shopify.capabilities')}</h3>
            <ul className='my-8px pl-20px text-13px text-t-secondary leading-7'>
              <li>{t('settings.plugins.shopify.products')}</li>
              <li>{t('settings.plugins.shopify.collections')}</li>
            </ul>
          </div>
          <div className='flex flex-col gap-8px border-t border-border-2 pt-16px'>
            <span role='status' className='text-13px font-500 text-t-primary'>
              {status}
            </span>
            <p id='shopify-connection-status' className='m-0 text-13px text-t-secondary'>
              {connection.available ? t('settings.plugins.shopify.flow') : t('settings.plugins.shopify.setup')}
            </p>
            <Button
              type='primary'
              className='self-start mt-4px'
              disabled={loading || !connection.available || connection.connected}
              loading={connecting}
              onClick={() => void connect()}
              aria-describedby='shopify-connection-status'
            >
              {t('settings.plugins.shopify.connect')}
            </Button>
          </div>
        </div>
      ) : (
        <div className='flex flex-wrap items-center justify-between gap-16px py-20px'>
          <div className='flex items-start gap-12px flex-1 min-w-0'>
            <Shop size={28} className='shrink-0 text-t-secondary' />
            <div className='min-w-0'>
              <div className='text-16px font-600 text-t-primary'>{t('settings.plugins.shopify.name')}</div>
              <p className='mt-4px mb-0 text-13px text-t-secondary'>{t('settings.plugins.shopify.description')}</p>
              <span className='block mt-8px text-12px text-t-secondary'>{status}</span>
            </div>
          </div>
          <Button icon={<Right size={16} />} onClick={() => setShowShopify(true)}>
            {t('settings.plugins.details')}
          </Button>
        </div>
      )}
    </div>
  );
};

const PluginsSettings: React.FC = () => {
  const { t } = useTranslation();
  return (
    <SettingsPageWrapper contentClassName='max-w-1200px'>
      <SettingsPageHeader title={t('settings.plugins.catalog')} description={t('settings.plugins.description')} />
      <ConnectorCatalog />
    </SettingsPageWrapper>
  );
};
export default PluginsSettings;

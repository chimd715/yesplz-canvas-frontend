import React, { Suspense, useEffect, useState } from 'react';
import { Button, Message, Tooltip } from '@arco-design/web-react';
import { Connection } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import AionModal from '@/renderer/components/base/AionModal';
import { emitter, useAddEventListener } from '@/renderer/utils/emitter';
import { useLocation } from 'react-router-dom';
import { submitConnectorPrompt } from '@/renderer/pages/conversation/platforms/useConnectorContinuation';

const ConnectorCatalog = React.lazy(() =>
  import('@/renderer/pages/settings/ToolsSettings/PluginsSettings').then((module) => ({
    default: module.ConnectorCatalog,
  }))
);

const SiderConnectorsEntry: React.FC<{ collapsed: boolean }> = ({ collapsed }) => {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [shopify, setShopify] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setVisible(false), [pathname]);
  useAddEventListener(
    'connectors.shopify.open',
    (_waiting, conversationId) => {
      if (
        !/^\/conversation\/[A-Za-z0-9_-]{1,100}$/.test(pathname) ||
        (conversationId && pathname !== `/conversation/${conversationId}`)
      )
        return;
      setShopify(true);
      setVisible(true);
    },
    [pathname]
  );
  return (
    <>
      <Tooltip content={collapsed ? t('settings.plugins.catalog') : null} position='right'>
        <Button
          type='text'
          aria-label={t('settings.plugins.catalog')}
          aria-haspopup='dialog'
          className={`!w-full !h-34px !text-t-primary !rounded-8px ${collapsed ? '' : '!text-left !px-10px'}`}
          onClick={() => {
            setShopify(false);
            setVisible(true);
          }}
        >
          <span className={`flex items-center gap-8px ${collapsed ? 'justify-center' : ''}`}>
            <Connection size={collapsed ? 20 : 16} />
            {!collapsed && <span className='text-14px font-500'>{t('settings.plugins.catalog')}</span>}
          </span>
        </Button>
      </Tooltip>
      {visible && (
        <AionModal
          visible
          onCancel={() => setVisible(false)}
          header={t(shopify ? 'settings.plugins.shopify.confirmTitle' : 'settings.plugins.catalog')}
          footer={null}
          escToExit
          focusLock
          style={{ width: shopify ? 560 : 1000, maxWidth: '96vw' }}
          contentStyle={{ maxHeight: '75vh', overflow: 'auto' }}
        >
          <Suspense fallback={<div role='status'>{t('common.loading')}</div>}>
            <ConnectorCatalog
              compact={shopify}
              onCancel={() => setVisible(false)}
              onSelected={(shop) => {
                const conversationId = pathname.match(/^\/conversation\/([A-Za-z0-9_-]{1,100})$/)?.[1];
                if (!conversationId) return;
                const prompt = t('settings.plugins.shopify.continuePrompt', { shop });
                void submitConnectorPrompt(prompt, conversationId, shop).catch(() => {
                  emitter.emit('sendbox.fill', prompt);
                  Message.error(t('settings.plugins.shopify.error'));
                });
                setVisible(false);
              }}
            />
          </Suspense>
        </AionModal>
      )}
    </>
  );
};
export default SiderConnectorsEntry;

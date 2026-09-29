import React, { Suspense, useEffect, useState } from 'react';
import { Button, Tooltip } from '@arco-design/web-react';
import { Connection } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import AionModal from '@/renderer/components/base/AionModal';
import { emitter, useAddEventListener } from '@/renderer/utils/emitter';
import { useLocation } from 'react-router-dom';

const ConnectorCatalog = React.lazy(() =>
  import('@/renderer/pages/settings/ToolsSettings/PluginsSettings').then((module) => ({
    default: module.ConnectorCatalog,
  }))
);

const SiderConnectorsEntry: React.FC<{ collapsed: boolean }> = ({ collapsed }) => {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [shopify, setShopify] = useState(false);
  const [questionWaiting, setQuestionWaiting] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setVisible(false), [pathname]);
  useAddEventListener(
    'connectors.shopify.open',
    (waiting, conversationId) => {
      if (
        !/^\/conversation\/[A-Za-z0-9_-]{1,100}$/.test(pathname) ||
        (conversationId && pathname !== `/conversation/${conversationId}`)
      )
        return;
      setShopify(true);
      setQuestionWaiting(waiting);
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
            setQuestionWaiting(false);
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
                if (!questionWaiting) {
                  emitter.emit(
                    'sendbox.fill',
                    `Use Shopify store ${shop} as the data source for this widget. Verify the available product and recommendation tools before implementation.`
                  );
                }
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

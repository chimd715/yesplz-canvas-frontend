import React, { Suspense, useState } from 'react';
import { Button, Tooltip } from '@arco-design/web-react';
import { Connection } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import AionModal from '@/renderer/components/base/AionModal';

const ConnectorCatalog = React.lazy(() =>
  import('@/renderer/pages/settings/ToolsSettings/PluginsSettings').then((module) => ({
    default: module.ConnectorCatalog,
  }))
);

const SiderConnectorsEntry: React.FC<{ collapsed: boolean }> = ({ collapsed }) => {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  return (
    <>
      <Tooltip content={collapsed ? t('settings.plugins.catalog') : null} position='right'>
        <Button
          type='text'
          aria-label={t('settings.plugins.catalog')}
          aria-haspopup='dialog'
          className={`!w-full !h-34px !text-t-primary !rounded-8px ${collapsed ? '' : '!text-left !px-10px'}`}
          onClick={() => setVisible(true)}
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
          header={t('settings.plugins.catalog')}
          footer={null}
          escToExit
          focusLock
          style={{ width: 1000, maxWidth: '96vw' }}
          contentStyle={{ maxHeight: '75vh', overflow: 'auto' }}
        >
          <Suspense fallback={<div role='status'>{t('common.loading')}</div>}>
            <ConnectorCatalog />
          </Suspense>
        </AionModal>
      )}
    </>
  );
};
export default SiderConnectorsEntry;

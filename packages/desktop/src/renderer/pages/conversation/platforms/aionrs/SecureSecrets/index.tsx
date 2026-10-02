/** @license Copyright 2025 AionUi (aionui.com) SPDX-License-Identifier: Apache-2.0 */
import { Alert, Button, Input, Message, Modal, Select, Typography } from '@arco-design/web-react';
import { Lock } from '@icon-park/react';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import { listSecrets, requestSecret, revokeSecret, uploadSecret, type SecretMetadata } from './client';

/** Dedicated browser channel; credential values never enter chat drafts, IPC, or model question answers. */
const SecretDialog: React.FC<{ conversationId: string }> = ({ conversationId }) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<SecretMetadata[]>([]);
  const [visible, setVisible] = useState(false);
  const [selected, setSelected] = useState<SecretMetadata>();
  const [name, setName] = useState('API_TOKEN');
  const [service, setService] = useState<'github' | 'opaque'>('opaque');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const dismissed = useRef(new Set<string>());
  const dialogOpen = useRef(false);
  const uploading = useRef(false);
  const operation = useRef<AbortController | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    let polling = false;
    const refresh = async (): Promise<void> => {
      if (polling) return;
      polling = true;
      try {
        const list = await listSecrets(conversationId, controller.signal);
        if (controller.signal.aborted) return;
        setRows(list);
        const pending = list.find((row) => row.state === 'pending' && !dismissed.current.has(row.id));
        if (pending && !dialogOpen.current && !uploading.current) {
          dialogOpen.current = true;
          setValue('');
          setError(false);
          dismissed.current.add(pending.id);
          setSelected(pending);
          setName(pending.name);
          setService(pending.service);
          setVisible(true);
        }
      } catch {
        /* Optional platform feature is unavailable on unconfigured standalone hosts. */
      } finally {
        polling = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      mounted.current = false;
      controller.abort();
      operation.current?.abort();
      operation.current = null;
      clearInterval(timer);
    };
  }, [conversationId]);

  const close = (): void => {
    operation.current?.abort();
    operation.current = null;
    uploading.current = false;
    setBusy(false);
    dialogOpen.current = false;
    setValue('');
    setError(false);
    setVisible(false);
    setSelected(undefined);
  };
  const save = async (): Promise<void> => {
    if (uploading.current || !value || value.length > 8192 || !/^[A-Z][A-Z0-9_]{0,63}$/.test(name)) return;
    const controller = new AbortController();
    operation.current = controller;
    const active = (): boolean => mounted.current && !controller.signal.aborted && operation.current === controller;
    uploading.current = true;
    setBusy(true);
    setError(false);
    try {
      const target = selected ?? (await requestSecret(conversationId, name, service, controller.signal));
      if (!active()) return;
      if (target.state === 'stored') {
        setValue('');
        setError(true);
        return;
      }
      const stored = await uploadSecret(conversationId, target.id, value, controller.signal);
      if (!active()) return;
      setRows((previous) => [...previous.filter((row) => row.id !== stored.id), stored]);
      close();
      Message.success(t('conversation.secureSecrets.saved'));
    } catch {
      if (active()) setError(true);
    } finally {
      if (active()) {
        operation.current = null;
        uploading.current = false;
        setBusy(false);
      }
    }
  };
  const revoke = async (id: string): Promise<void> => {
    if (uploading.current) return;
    const controller = new AbortController();
    operation.current = controller;
    const active = (): boolean => mounted.current && !controller.signal.aborted && operation.current === controller;
    uploading.current = true;
    setBusy(true);
    setError(false);
    try {
      await revokeSecret(conversationId, id, controller.signal);
      if (active()) setRows((previous) => previous.filter((row) => row.id !== id));
    } catch {
      if (active()) setError(true);
    } finally {
      if (active()) {
        operation.current = null;
        uploading.current = false;
        setBusy(false);
      }
    }
  };

  return (
    <>
      <div className='flex justify-end py-4px'>
        <Button
          size='mini'
          type='text'
          disabled={busy}
          icon={<Lock size={14} />}
          data-testid='secure-secrets-open'
          onClick={() => {
            dialogOpen.current = true;
            const pending = rows.find((row) => row.state === 'pending');
            setSelected(pending);
            setName(pending?.name ?? 'API_TOKEN');
            setService(pending?.service ?? 'opaque');
            setError(false);
            setValue('');
            setVisible(true);
          }}
        >
          {t('conversation.secureSecrets.title')}
        </Button>
      </div>
      <Modal
        visible={visible}
        title={t('conversation.secureSecrets.title')}
        onCancel={close}
        onOk={() => void save()}
        confirmLoading={busy}
        okButtonProps={{ disabled: !value || value.length > 8192 || !/^[A-Z][A-Z0-9_]{0,63}$/.test(name) }}
        maskClosable={false}
        unmountOnExit
        okText={t('common.save')}
        cancelText={t('common.cancel')}
      >
        <Alert type='info' content={t('conversation.secureSecrets.description')} className='mb-16px' />
        <Typography.Text>{t('conversation.secureSecrets.service')}</Typography.Text>
        <Select
          value={service}
          disabled={!!selected || busy}
          onChange={setService}
          className='mt-8px mb-16px'
          options={[
            { value: 'opaque', label: t('conversation.secureSecrets.generic') },
            { value: 'github', label: t('conversation.secureSecrets.github') },
          ]}
        />
        <Typography.Text>{t('conversation.secureSecrets.name')}</Typography.Text>
        <Input
          value={name}
          disabled={!!selected || busy}
          maxLength={64}
          onChange={setName}
          className='mt-8px mb-16px'
          data-testid='secure-secret-name'
        />
        <Typography.Text>{t('conversation.secureSecrets.value')}</Typography.Text>
        <Input.Password
          value={value}
          disabled={busy}
          visibilityToggle={false}
          autoComplete='new-password'
          maxLength={8192}
          onChange={setValue}
          className='mt-8px mb-16px'
          data-testid='secure-secret-value'
        />
        {error && <Alert type='error' content={t('conversation.secureSecrets.error')} />}
        {rows
          .filter((row) => row.state === 'stored')
          .map((row) => (
            <div key={row.id} className='flex items-center justify-between mt-12px'>
              <Typography.Text>{row.name}</Typography.Text>
              <Button size='small' status='danger' disabled={busy} onClick={() => void revoke(row.id)}>
                {t('conversation.secureSecrets.revoke')}
              </Button>
            </div>
          ))}
      </Modal>
    </>
  );
};
const SecureSecrets: React.FC<{ conversationId: string }> = ({ conversationId }) => {
  const { status, user } = useAuth();
  if (status !== 'authenticated') return null;
  // The dialog and all in-flight operations belong to exactly one account/conversation.
  return <SecretDialog key={`${user?.id ?? 'local'}:${conversationId}`} conversationId={conversationId} />;
};
export default SecureSecrets;

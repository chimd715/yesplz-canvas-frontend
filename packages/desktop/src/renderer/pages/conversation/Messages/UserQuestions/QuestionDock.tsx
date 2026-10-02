/** @license Copyright 2025 AionUi (aionui.com) SPDX-License-Identifier: Apache-2.0 */
import { Alert, Button } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import MessageQuestion from './MessageQuestion';
import { usePendingQuestions } from './usePendingQuestions';

const ScopedQuestionDock: React.FC<{ conversationId: string }> = ({ conversationId }) => {
  const { t } = useTranslation();
  const { pending, error, refresh, resolve } = usePendingQuestions(conversationId);
  return (
    <>
      {error && (
        <Alert
          type='warning'
          content={t('messages.askRecoveryError')}
          action={
            <Button size='small' onClick={() => void refresh()}>
              {t('messages.askRetry')}
            </Button>
          }
        />
      )}
      {pending[0] && <MessageQuestion message={pending[0].message} onResolved={resolve} />}
    </>
  );
};
const QuestionDock: React.FC<{ conversationId: string }> = ({ conversationId }) => {
  const { status, user } = useAuth();
  if (status !== 'authenticated') return null;
  return <ScopedQuestionDock key={`${user?.id ?? 'local'}:${conversationId}`} conversationId={conversationId} />;
};
export default QuestionDock;

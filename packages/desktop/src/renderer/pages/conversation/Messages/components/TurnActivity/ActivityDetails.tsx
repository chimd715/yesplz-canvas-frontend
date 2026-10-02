import { ipcBridge } from '@/common';
import { Button, Spin } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getActivityTools, sanitizeActivityMessage } from './activityTimeline';
import type { ActivityMessage } from './types';
import styles from './TurnActivity.module.css';

const isCompact = (message: ActivityMessage): boolean =>
  (message.content as { _compact?: { truncated?: boolean } })?._compact?.truncated === true;

const ActivityDetails: React.FC<{ message: ActivityMessage; active: boolean }> = ({ message, active }) => {
  const { t } = useTranslation();
  const [full, setFull] = useState<{ source: ActivityMessage; message: ActivityMessage }>();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!isCompact(message)) {
      setLoading(false);
      setFailed(false);
      return;
    }
    let disposed = false;
    setLoading(true);
    setFailed(false);
    void ipcBridge.database.getConversationMessage
      .invoke({
        conversation_id: message.conversation_id,
        message_id: message.id,
      })
      .then((response) => {
        if (disposed) return;
        const next =
          response &&
          response.id === message.id &&
          response.conversation_id === message.conversation_id &&
          response.type === message.type
            ? sanitizeActivityMessage(response)
            : undefined;
        if (!next || isCompact(next)) throw new Error('Invalid activity response');
        setFull({ source: message, message: next });
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    // IPC does not expose AbortSignal. Ignore all completions after collapse,
    // scope change or a newer source row, including a delayed failed request.
    return () => {
      disposed = true;
    };
  }, [message, attempt]);

  const display = full?.source === message ? full.message : message;
  if (display.type === 'thinking') {
    return (
      <li className={styles.detail} data-activity-kind='thinking'>
        <span className={styles.detailTitle}>{t('messages.activity.thinking')}</span>
        <pre className={styles.content}>{display.content.content}</pre>
      </li>
    );
  }
  if (display.type === 'agent_status') {
    return (
      <li className={styles.detail} data-activity-kind='agent_status'>
        <span className={styles.detailTitle}>{display.content.agent_name || display.content.backend}</span>
        <span>
          {t(`acp.status.${display.content.status}`, { agent: display.content.agent_name || display.content.backend })}
        </span>
      </li>
    );
  }
  return (
    <li className={styles.detail} data-activity-kind='tool'>
      {loading && <Spin size={12} />}
      {failed && (
        <div role='alert' className={styles.error}>
          <span>{t('messages.activity.loadFailed')}</span>
          <Button size='mini' onClick={() => setAttempt((value) => value + 1)}>
            {t('common.retry')}
          </Button>
        </div>
      )}
      {getActivityTools(display).map((tool) => (
        <div key={tool.key} className={styles.tool}>
          <div className={styles.detailTitle}>
            <span>{tool.name}</span>
            <span className={styles.toolStatus}>
              {t(
                `messages.activity.${!active && ['pending', 'running'].includes(tool.status) ? 'stopped' : tool.status}`
              )}
            </span>
          </div>
          {tool.description && <p className={styles.description}>{tool.description}</p>}
          {tool.input && (
            <div>
              <span className={styles.label}>{t('messages.activity.input')}</span>
              <pre className={styles.content}>{tool.input}</pre>
            </div>
          )}
          {tool.output && (
            <div>
              <span className={styles.label}>{t('messages.activity.output')}</span>
              <pre className={styles.content}>{tool.output}</pre>
            </div>
          )}
        </div>
      ))}
    </li>
  );
};

export default ActivityDetails;

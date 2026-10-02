import { Button, Spin } from '@arco-design/web-react';
import { CheckOne, CloseOne, Down, Right } from '@icon-park/react';
import React, { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ActivityDetails from './ActivityDetails';
import { getActivityTools, latestActivityMessage } from './activityTimeline';
import type { TurnActivitySummary } from './types';
import styles from './TurnActivity.module.css';

const TurnActivity: React.FC<{ summary: TurnActivitySummary }> = ({ summary }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const latest = latestActivityMessage(summary);
  const tools = summary.messages.flatMap(getActivityTools);
  const latestTool = getActivityTools(latest).at(-1);
  const finalStatus = tools.some((tool) => tool.status === 'error')
    ? 'error'
    : tools.some((tool) => tool.status === 'canceled')
      ? 'canceled'
      : summary.messages.some((message) => message.type === 'agent_status' && message.content.status === 'error')
        ? 'error'
        : tools.some((tool) => ['pending', 'running'].includes(tool.status))
          ? 'stopped'
          : 'completed';
  const activeLabel =
    latest.type === 'thinking'
      ? latest.content.subject || t('messages.activity.thinking')
      : latestTool
        ? `${t(`messages.activity.${latestTool.status}`)} · ${latestTool.name}`
        : t('messages.activity.running');
  const label = summary.active ? activeLabel : t(`messages.activity.${finalStatus}`);
  const description =
    summary.active && latest.type === 'thinking'
      ? latest.content.content?.trim().replace(/\s+/g, ' ').slice(-160)
      : undefined;

  return (
    <section className={styles.activity} data-testid='turn-activity' data-activity-id={summary.id}>
      <Button
        type='text'
        long
        className={styles.header}
        aria-expanded={expanded}
        aria-controls={detailsId}
        aria-label={t(expanded ? 'messages.activity.hide' : 'messages.activity.show')}
        onClick={() => setExpanded((value) => !value)}
      >
        {summary.active ? (
          <Spin size={12} />
        ) : finalStatus === 'error' ? (
          <CloseOne theme='outline' size='14' />
        ) : (
          <CheckOne theme='outline' size='14' />
        )}
        <span className={styles.latest} aria-live='polite' aria-atomic='true'>
          <span>{label}</span>
          {description && <span className={styles.description}> · {description}</span>}
        </span>
        <span className={styles.count}>{summary.messages.length}</span>
        {expanded ? <Down theme='outline' size='12' /> : <Right theme='outline' size='12' />}
      </Button>
      {expanded && (
        <ol id={detailsId} className={styles.details}>
          {summary.messages.map((message) => (
            <ActivityDetails key={message.id} message={message} active={summary.active} />
          ))}
        </ol>
      )}
    </section>
  );
};

export default React.memo(TurnActivity);

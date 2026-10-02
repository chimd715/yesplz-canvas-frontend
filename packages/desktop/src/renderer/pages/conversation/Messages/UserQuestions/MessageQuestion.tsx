/** @license Copyright 2025 AionUi (aionui.com) SPDX-License-Identifier: Apache-2.0 */
import { conversation } from '@/common/adapter/ipcBridge';
import type { IAskQuestion, IMessageAsk } from '@/common/chat/chatLib';
import { Alert, Button, Card, Checkbox, Input, Radio } from '@arco-design/web-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from '../components/MessagePermission/PermissionRequestPanel.module.css';
import own from './MessageQuestion.module.css';

const OTHER_VALUE = '__aionui_other__';
type Draft = { labels: string[]; other: string; otherSelected: boolean };
type Props = { message: IMessageAsk; onResolved?: (requestId: string) => void };
const emptyDraft = (): Draft => ({ labels: [], other: '', otherSelected: false });
const answered = (draft: Draft): boolean =>
  (!draft.otherSelected ||
    (draft.other.trim().length > 0 && new TextEncoder().encode(draft.other.trim()).length <= 2048)) &&
  (draft.labels.length > 0 || draft.otherSelected);

/** One question per step, one complete batch on the dedicated answer channel. */
const QuestionForm: React.FC<Props> = ({ message, onResolved }) => {
  const { t } = useTranslation();
  const questions: IAskQuestion[] = Array.isArray(message.content.questions) ? message.content.questions : [];
  const [drafts, setDrafts] = useState<Draft[]>(() => questions.map(emptyDraft));
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [submitted, setSubmitted] = useState<'answered' | 'declined' | null>(null);
  const submitting = useRef(false);
  const mounted = useRef(false);
  const heading = useRef<HTMLDivElement>(null);
  const requestId = message.content.request_id || message.id;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [step]);

  const updateDraft = useCallback((index: number, patch: Partial<Draft>) => {
    if (submitting.current) return;
    setDrafts((previous) => previous.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));
    setError(false);
  }, []);

  const submit = async (decline: boolean): Promise<void> => {
    if (submitting.current || submitted || (!decline && !drafts.every(answered))) return;
    submitting.current = true;
    setBusy(true);
    setError(false);
    try {
      await conversation.answerAsk.invoke({
        conversation_id: message.conversation_id,
        request_id: requestId,
        ...(decline
          ? { decline: true }
          : {
              answers: questions.map((question, index) => ({
                question: question.question,
                labels: [...drafts[index].labels, ...(drafts[index].otherSelected ? [drafts[index].other.trim()] : [])],
              })),
            }),
      });
      if (!mounted.current) return;
      setSubmitted(decline ? 'declined' : 'answered');
      onResolved?.(requestId);
    } catch {
      if (mounted.current) setError(true);
    } finally {
      if (mounted.current) {
        submitting.current = false;
        setBusy(false);
      }
    }
  };
  if (!questions.length) return null;
  const question = questions[step];
  const draft = drafts[step];
  const multi = question.multiSelect === true || question.multi_select === true;
  const optionContent = (option: IAskQuestion['options'][number]) => (
    <span className={own.optionText}>
      <span className={own.optionLabel}>{option.label}</span>
      {option.description && <span className={own.optionDesc}>{option.description}</span>}
    </span>
  );

  return (
    <Card className={`${styles.card} ${own.dockedCard}`} bordered={false} data-testid='message-question'>
      <div className={styles.panel}>
        <div className={own.progress} role='status' aria-live='polite'>
          {t('messages.askProgress', { current: step + 1, total: questions.length })}
        </div>
        {submitted ? (
          <div role='status'>{t(submitted === 'answered' ? 'messages.askAnswered' : 'messages.askDeclined')}</div>
        ) : (
          <>
            <div className={own.questionBlock} data-testid={`message-question-item-${step}`}>
              {question.header && <div className={own.header}>{question.header}</div>}
              <div className={own.question} ref={heading} tabIndex={-1} id={`ask-heading-${requestId}`}>
                {question.question}
              </div>
              {multi ? (
                <Checkbox.Group
                  className={own.optionList}
                  value={[...draft.labels, ...(draft.otherSelected ? [OTHER_VALUE] : [])]}
                  disabled={busy}
                  aria-labelledby={`ask-heading-${requestId}`}
                  onChange={(values) =>
                    updateDraft(step, {
                      labels: (values as string[]).filter((label) => label !== OTHER_VALUE),
                      otherSelected: values.includes(OTHER_VALUE),
                    })
                  }
                >
                  {question.options.map((option) => (
                    <Checkbox
                      key={option.label}
                      className={own.optionRow}
                      value={option.label}
                      data-testid={`message-question-option-${step}-${option.label}`}
                    >
                      {optionContent(option)}
                    </Checkbox>
                  ))}
                  <Checkbox
                    className={own.optionRow}
                    value={OTHER_VALUE}
                    data-testid={`message-question-option-${step}-other`}
                  >
                    {t('messages.askOther')}
                  </Checkbox>
                </Checkbox.Group>
              ) : (
                <Radio.Group
                  className={own.optionList}
                  value={draft.otherSelected ? OTHER_VALUE : draft.labels[0]}
                  disabled={busy}
                  aria-labelledby={`ask-heading-${requestId}`}
                  onChange={(value) =>
                    updateDraft(
                      step,
                      value === OTHER_VALUE
                        ? { labels: [], otherSelected: true }
                        : { labels: [value], otherSelected: false }
                    )
                  }
                >
                  {question.options.map((option) => (
                    <Radio
                      key={option.label}
                      className={own.optionRow}
                      value={option.label}
                      data-testid={`message-question-option-${step}-${option.label}`}
                    >
                      {optionContent(option)}
                    </Radio>
                  ))}
                  <Radio
                    className={own.optionRow}
                    value={OTHER_VALUE}
                    data-testid={`message-question-option-${step}-other`}
                  >
                    {t('messages.askOther')}
                  </Radio>
                </Radio.Group>
              )}
              {draft.otherSelected && (
                <Input
                  className={own.otherInput}
                  aria-label={t('messages.askOtherPlaceholder')}
                  placeholder={t('messages.askOtherPlaceholder')}
                  value={draft.other}
                  maxLength={2048}
                  disabled={busy}
                  onChange={(other) => updateDraft(step, { other })}
                  data-testid={`message-question-other-input-${step}`}
                />
              )}
            </div>
            {error && (
              <Alert type='error' content={t('messages.askSubmitError')} data-testid='message-question-error' />
            )}
            <div className={own.actions}>
              {step > 0 && (
                <Button
                  size='small'
                  disabled={busy}
                  onClick={() => setStep((index) => (index === step ? Math.max(0, index - 1) : index))}
                  data-testid='message-question-back'
                >
                  {t('messages.askBack')}
                </Button>
              )}
              {step < questions.length - 1 ? (
                <Button
                  type='primary'
                  size='small'
                  disabled={busy || !answered(draft)}
                  onClick={() =>
                    setStep((index) => (index === step ? Math.min(questions.length - 1, index + 1) : index))
                  }
                  data-testid='message-question-next'
                >
                  {t('messages.askNext')}
                </Button>
              ) : (
                <Button
                  type='primary'
                  size='small'
                  loading={busy}
                  disabled={busy || !drafts.every(answered)}
                  onClick={() => void submit(false)}
                  data-testid='message-question-submit'
                >
                  {t('messages.askSubmit')}
                </Button>
              )}
              <Button
                size='small'
                disabled={busy}
                onClick={() => void submit(true)}
                data-testid='message-question-decline'
              >
                {t('messages.askDecline')}
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
};

/** A changed account/conversation/request unmounts its drafts and ignores stale completions. */
const MessageQuestion: React.FC<Props> = (props) => (
  <QuestionForm
    key={`${props.message.conversation_id}:${props.message.content.request_id || props.message.id}`}
    {...props}
  />
);
export default MessageQuestion;

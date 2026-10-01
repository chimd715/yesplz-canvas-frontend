/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { conversation } from '@/common/adapter/ipcBridge';
import type { IAskQuestion, IMessageAsk } from '@/common/chat/chatLib';
import { Button, Card, Checkbox, Input, Radio } from '@arco-design/web-react';
import { CheckOne } from '@icon-park/react';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { emitter } from '@/renderer/utils/emitter';
import { useConversationContextSafe } from '@/renderer/hooks/context/ConversationContext';
import { isNativeRuntimeActive } from '@/common/adapter/httpBridge';
// The permission panel's stylesheet supplies the shared card chrome; own.* adds
// the question-specific pieces (option rows with secondary description lines),
// built on the same tokens so the two cards read as siblings (user feedback,
// 2026-08-04: same style family, and long text must wrap instead of clipping).
import styles from './components/MessagePermission/PermissionRequestPanel.module.css';
import own from './MessageQuestion.module.css';

const OTHER_VALUE = '__aionui_other__';

type MessageQuestionProps = {
  message: IMessageAsk;
  /** Native text questions use the composer, not Claude's dedicated answer endpoint. */
  onAnswer?: (answers: { question: string; labels: string[] }[]) => Promise<void>;
};

/** Recognize the product-owned native platform prompt without treating code samples as questions. */
export const hasWidgetPlatformPrompt = (text: string): boolean => {
  const prose = text.replace(/```[\s\S]*?(?:```|$)/g, '');
  if (prose.includes('[SHOP_WIDGET_PLATFORM]')) return true;
  // ponytail: legacy question matching is limited to the two fixed choices and a store-platform question.
  return (
    /\bShopify\b/.test(prose) &&
    /\bOther\b/.test(prose) &&
    (prose.includes('Which platform is your store on?') ||
      /(?:어떤|어느|무슨)[^\n?？]{0,80}(?:플랫폼|쇼핑몰|스토어|샵)[^\n?？]{0,80}[?？]/.test(prose) ||
      /(?:쇼핑몰|스토어|샵|플랫폼)[^\n?？]{0,80}(?:어디|어떤|어느|선택)[^\n?？]{0,80}[?？]/.test(prose))
  );
};

type Draft = {
  /** selected option labels (multiSelect keeps several; single keeps one) */
  labels: string[];
  /** free text when the Other row is selected */
  other: string;
  otherSelected: boolean;
};

const emptyDraft = (): Draft => ({ labels: [], other: '', otherSelected: false });

// ponytail: recognize the fixed skill question only; add explicit action metadata if more questions need connectors.
export const isStorePlatformQuestion = (q: IAskQuestion) =>
  q.question === 'Which platform is your store on?' &&
  q.options.length === 2 &&
  q.options.some((o) => o.label === 'Shopify') &&
  q.options.some((o) => o.label === 'Other') &&
  !q.multiSelect &&
  !q.multi_select;

/** Only registered connector actions can open product-owned connection UI. */
export const isShopifyConnectorOption = (q: IAskQuestion, label: string, allowLegacy = false): boolean => {
  const option = q.options.find((item) => item.label === label);
  if (!option) return false;
  if (option.action !== undefined) {
    return option.action?.type === 'connect' && option.action?.connector === 'shopify';
  }
  return allowLegacy && label === 'Shopify' && isStorePlatformQuestion(q);
};

/**
 * Structured question card (`ask` frame — claude AskUserQuestion).
 *
 * One submit answers EVERY question at once: claude silently DROPS unanswered
 * questions on an allow (it does not re-ask — live 2.1.178), so per-question
 * submission would be silent data loss. Submit stays disabled until every
 * question has an answer; dismiss sends an explicit decline (a deny on the
 * wire), never an empty allow.
 */
const MessageQuestion: React.FC<MessageQuestionProps> = React.memo(({ message, onAnswer }) => {
  const { t } = useTranslation();
  const context = useConversationContextSafe();
  const readOnly = !!context?.readOnly || !isNativeRuntimeActive();
  const allowLegacy = !context?.creationMode;
  const content = message.content || ({} as IMessageAsk['content']);
  const questions = useMemo<IAskQuestion[]>(
    () => (Array.isArray(content.questions) ? content.questions : []),
    [content.questions]
  );
  const [drafts, setDrafts] = useState<Draft[]>(() => questions.map(emptyDraft));
  const [submitted, setSubmitted] = useState<'answered' | 'declined' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [connectionError, setConnectionError] = useState(false);

  const updateDraft = useCallback((index: number, patch: Partial<Draft>) => {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }, []);

  const answered = (d: Draft) => d.labels.length > 0 || (d.otherSelected && d.other.trim().length > 0);
  const allAnswered = questions.length > 0 && drafts.every(answered);

  const requestId = content.request_id || message.id;

  const handleSubmit = useCallback(async () => {
    if (readOnly || !isNativeRuntimeActive() || submitting) return;
    setSubmitting(true);
    setConnectionError(false);
    try {
      let shop: string | undefined;
      if (
        questions.some((q, i) => drafts[i]?.labels.some((label) => isShopifyConnectorOption(q, label, allowLegacy)))
      ) {
        const response = await fetch(
          '/api/platform/connectors/shopify?conversationId=' + encodeURIComponent(message.conversation_id),
          { credentials: 'same-origin' }
        );
        if (!response.ok) throw new Error('Connection status unavailable');
        const data = await response.json();
        if (
          data.connected !== true ||
          typeof data.shop !== 'string' ||
          !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(data.shop)
        ) {
          emitter.emit('connectors.shopify.open', true, message.conversation_id);
          return;
        }
        shop = data.shop;
      }
      // claude keys its answers map by the question TEXT; a multi-select answer
      // is an array of labels (claude joins with ", "). Other-text rides as a
      // plain label — claude accepts arbitrary answer strings. Sent over the
      // DEDICATED ask channel, not the permission confirm endpoint.
      const answers = questions.map((q, i) => {
        const d = drafts[i];
        const labels = d.labels.map((label) =>
          shop && isShopifyConnectorOption(q, label, allowLegacy) ? `${label} (selected store: ${shop})` : label
        );
        if (d.otherSelected && d.other.trim()) labels.push(d.other.trim());
        return { question: q.question, labels };
      });
      if (onAnswer) await onAnswer(answers);
      else
        await conversation.answerAsk.invoke({
          conversation_id: message.conversation_id,
          request_id: requestId,
          answers,
        });
      setSubmitted('answered');
    } catch {
      setConnectionError(true);
    } finally {
      setSubmitting(false);
    }
  }, [drafts, questions, message.conversation_id, requestId, submitting, onAnswer, readOnly, allowLegacy]);

  const handleDecline = useCallback(async () => {
    if (readOnly || !isNativeRuntimeActive() || submitting) return;
    setSubmitting(true);
    setConnectionError(false);
    try {
      if (!onAnswer)
        await conversation.answerAsk.invoke({
          conversation_id: message.conversation_id,
          request_id: requestId,
          decline: true,
        });
      setSubmitted('declined');
    } catch {
      setConnectionError(true);
    } finally {
      setSubmitting(false);
    }
  }, [message.conversation_id, requestId, onAnswer, submitting, readOnly]);

  if (!questions.length) return null;

  return (
    <Card className={styles.card} bordered={false} data-testid='message-question'>
      <div className={styles.panel}>
        {questions.map((q, qi) => {
          const d = drafts[qi] ?? emptyDraft();
          // Wire spelling is multi_select (the ws relay snake_cases all keys).
          const multi = q.multiSelect === true || q.multi_select === true;
          return (
            <div key={qi} className={own.questionBlock} data-testid={`message-question-item-${qi}`}>
              {q.header ? <div className={own.header}>{q.header}</div> : null}
              <div className={own.question}>{q.question}</div>
              {q.options.length === 0 ? (
                <Input
                  className={own.otherInput}
                  aria-label={q.question}
                  placeholder={t('messages.askParameterPlaceholder')}
                  value={d.other}
                  onChange={(other) => updateDraft(qi, { other, otherSelected: true })}
                  disabled={readOnly || submitted !== null || submitting}
                  maxLength={4000}
                  data-testid={`message-question-other-input-${qi}`}
                />
              ) : multi ? (
                <Checkbox.Group
                  className={own.optionList}
                  value={d.labels}
                  onChange={(labels) => updateDraft(qi, { labels: labels as string[] })}
                  disabled={readOnly || submitted !== null}
                >
                  {q.options.map((opt) => (
                    <Checkbox
                      key={opt.label}
                      className={own.optionRow}
                      value={opt.label}
                      data-testid={`message-question-option-${qi}-${opt.label}`}
                    >
                      <span className={own.optionText}>
                        <span className={own.optionLabel}>{opt.label}</span>
                        {opt.description ? <span className={own.optionDesc}>{opt.description}</span> : null}
                      </span>
                    </Checkbox>
                  ))}
                </Checkbox.Group>
              ) : (
                <Radio.Group
                  className={own.optionList}
                  value={d.otherSelected ? OTHER_VALUE : d.labels[0]}
                  onChange={(value) => {
                    if (readOnly || !isNativeRuntimeActive()) return;
                    if (isShopifyConnectorOption(q, String(value), allowLegacy))
                      emitter.emit('connectors.shopify.open', true, message.conversation_id);
                    if (value === OTHER_VALUE) updateDraft(qi, { labels: [], otherSelected: true });
                    else updateDraft(qi, { labels: [value], otherSelected: false });
                  }}
                  disabled={readOnly || submitted !== null || submitting}
                >
                  {q.options.map((opt) => (
                    <Radio
                      key={opt.label}
                      className={own.optionRow}
                      value={opt.label}
                      data-testid={`message-question-option-${qi}-${opt.label}`}
                    >
                      <span className={own.optionText}>
                        <span className={own.optionLabel}>{opt.label}</span>
                        {opt.description ? <span className={own.optionDesc}>{opt.description}</span> : null}
                      </span>
                    </Radio>
                  ))}
                  {!(allowLegacy && isStorePlatformQuestion(q)) && (
                    <Radio
                      className={own.optionRow}
                      value={OTHER_VALUE}
                      data-testid={`message-question-option-${qi}-other`}
                    >
                      <span className={own.optionText}>
                        <span className={own.optionLabel}>{t('messages.askOther')}</span>
                      </span>
                    </Radio>
                  )}
                  {d.otherSelected ? (
                    <Input
                      className={own.otherInput}
                      placeholder={t('messages.askOtherPlaceholder')}
                      value={d.other}
                      onChange={(v) => updateDraft(qi, { other: v })}
                      disabled={readOnly || submitted !== null}
                      data-testid={`message-question-other-input-${qi}`}
                    />
                  ) : null}
                </Radio.Group>
              )}
            </div>
          );
        })}
        {connectionError && <p role='alert'>{t('messages.askSubmitError')}</p>}
        {onAnswer && submitted === 'answered' && <p role='status'>{t('settings.plugins.shopify.answerReady')}</p>}
        {submitted === null ? (
          // Plain Arco buttons on purpose: styles.optionButton resets the button
          // chrome to a transparent full-width list row (for permission option
          // lists), which turned the primary submit into white-on-white.
          <div className={own.actions}>
            <Button
              type='primary'
              size='small'
              disabled={readOnly || !allAnswered}
              loading={submitting}
              onClick={handleSubmit}
              data-testid='message-question-submit'
            >
              {t('messages.askSubmit')}
            </Button>
            <Button
              size='small'
              disabled={readOnly || submitting}
              onClick={handleDecline}
              data-testid='message-question-decline'
            >
              {t('messages.askDecline')}
            </Button>
          </div>
        ) : (
          <div
            className={`${styles.feedback} ${styles.success}`}
            role='status'
            aria-live='polite'
            data-testid='message-question-status'
          >
            <CheckOne theme='outline' size='16' aria-hidden='true' />
            <span>{submitted === 'answered' ? t('messages.askAnswered') : t('messages.askDeclined')}</span>
          </div>
        )}
      </div>
    </Card>
  );
});

export default MessageQuestion;

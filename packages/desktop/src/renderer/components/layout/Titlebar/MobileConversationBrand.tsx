/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { AgentLogoIcon } from '@/renderer/components/agent/AgentBadge';
import { usePresetAssistantInfo } from '@/renderer/hooks/agent/usePresetAssistantInfo';
import { resolveConversationBackend } from '@/renderer/pages/conversation/utils/conversationAssistantIdentity';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import useSWR from 'swr';

type MobileConversationBrandProps = {
  conversation_id: string;
  fallbackTitle: string;
};

const MobileConversationBrand: React.FC<MobileConversationBrandProps> = ({ conversation_id, fallbackTitle }) => {
  const { t } = useTranslation();
  const { data: conversation } = useSWR(
    conversation_id ? `mobile-titlebar.conversation.${conversation_id}` : null,
    () => ipcBridge.conversation.get.invoke({ id: conversation_id })
  );
  const { info: presetAssistant } = usePresetAssistantInfo(conversation || undefined);
  const backend = resolveConversationBackend(conversation, presetAssistant?.backend);

  const showLogo = Boolean(backend || presetAssistant);
  const title = conversation?.name || fallbackTitle;

  return (
    <Link to='/guid' className='app-titlebar__brand-mobile app-titlebar__brand-home' aria-label={t('login.brand')}>
      {showLogo && (
        <AgentLogoIcon
          backend={backend}
          agent_name={title}
          agentLogo={presetAssistant?.logo}
          agentLogoIsEmoji={presetAssistant?.isEmoji}
          agentLogoIsFallback={presetAssistant?.isFallback}
        />
      )}
      <span className='app-titlebar__brand-text'>{title}</span>
    </Link>
  );
};

export default MobileConversationBrand;

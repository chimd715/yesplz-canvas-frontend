/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export { useHistoryRequestScope, isHistoryRequestCurrent } from './useHistoryRequestScope';
export type { HistoryRequestScope, HistoryRequestScopeRef } from './useHistoryRequestScope';
export {
  usePendingConfirmationsRecovery,
  buildPendingConfirmationMessage,
  hasPermissionMessageForCallId,
  removePermissionMessage,
} from './usePendingConfirmationsRecovery';
export {
  EMPTY_MESSAGE_PAGINATION_STATE,
  MessagePaginationProvider,
  useMessagePaginationState,
  useUpdateMessagePaginationState,
} from './contexts';
export type { MessagePaginationState } from './contexts';

/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createContext } from '@renderer/utils/ui/createContext';

export type MessagePaginationState = {
  oldestCursor?: string;
  newestCursor?: string;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  isLoadingBefore: boolean;
  isLoadingAnchor: boolean;
};

export const EMPTY_MESSAGE_PAGINATION_STATE: MessagePaginationState = {
  hasMoreBefore: false,
  hasMoreAfter: false,
  isLoadingBefore: false,
  isLoadingAnchor: false,
};

export const [useMessagePaginationState, MessagePaginationProvider, useUpdateMessagePaginationState] =
  createContext<MessagePaginationState>(EMPTY_MESSAGE_PAGINATION_STATE);

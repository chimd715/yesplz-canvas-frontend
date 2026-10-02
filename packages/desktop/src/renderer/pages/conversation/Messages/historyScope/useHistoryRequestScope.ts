/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MutableRefObject } from 'react';
import type { TMessage } from '@/common/chat/chatLib';
import { useUpdateMessagePaginationState } from './contexts';

export type HistoryRequestScope = {
  conversationId: string;
  epoch: number;
  active: boolean;
  window: 'latest' | 'first' | 'anchor';
  navigationEpoch?: number;
  navigationLiveBuffer?: { epoch: number; messages: TMessage[]; applied?: boolean };
};

export type HistoryRequestScopeRef = MutableRefObject<HistoryRequestScope>;

// The provider's state setter stays stable across renders and is released on
// unmount. All readers and live writers in that provider share this identity.
const historyScopes = new WeakMap<ReturnType<typeof useUpdateMessagePaginationState>, HistoryRequestScopeRef>();

/** Read shared generations; the cache alone binds the current conversation. */
export const useHistoryRequestScope = (conversationId?: string): HistoryRequestScopeRef => {
  const setPagination = useUpdateMessagePaginationState();
  let ref = historyScopes.get(setPagination);
  if (!ref) {
    ref = { current: { conversationId: conversationId ?? '', epoch: 0, active: false, window: 'latest' } };
    historyScopes.set(setPagination, ref);
  }
  return ref;
};

/** Check both scope identity and request generation before applying any result. */
export const isHistoryRequestCurrent = (
  ref: HistoryRequestScopeRef,
  scope: HistoryRequestScope,
  epoch = scope.epoch
): boolean => ref.current === scope && scope.active && scope.epoch === epoch;

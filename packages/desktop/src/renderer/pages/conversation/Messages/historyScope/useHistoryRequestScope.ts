/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MutableRefObject } from 'react';
import { useUpdateMessagePaginationState } from './contexts';

export type HistoryRequestScope = {
  conversationId: string;
  epoch: number;
  active: boolean;
  window: 'latest' | 'first' | 'anchor';
  navigationEpoch?: number;
};

export type HistoryRequestScopeRef = MutableRefObject<HistoryRequestScope>;

// The provider's state setter stays stable across renders and is released on
// unmount. All readers and live writers in that provider share this identity.
const historyScopes = new WeakMap<ReturnType<typeof useUpdateMessagePaginationState>, HistoryRequestScopeRef>();

/** Share request generations within one mounted conversation history provider. */
export const useHistoryRequestScope = (conversationId?: string): HistoryRequestScopeRef => {
  const setPagination = useUpdateMessagePaginationState();
  let ref = historyScopes.get(setPagination);
  if (!ref) {
    ref = { current: { conversationId: conversationId ?? '', epoch: 0, active: false, window: 'latest' } };
    historyScopes.set(setPagination, ref);
  } else if (conversationId !== undefined && ref.current.conversationId !== conversationId) {
    ref.current.active = false;
    ref.current = { conversationId, epoch: ref.current.epoch + 1, active: false, window: 'latest' };
  }
  return ref;
};

/** Check both scope identity and request generation before applying any result. */
export const isHistoryRequestCurrent = (
  ref: HistoryRequestScopeRef,
  scope: HistoryRequestScope,
  epoch = scope.epoch
): boolean => ref.current === scope && scope.active && scope.epoch === epoch;

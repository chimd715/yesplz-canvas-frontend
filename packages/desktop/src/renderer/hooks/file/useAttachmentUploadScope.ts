/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useLayoutEffect, useRef } from 'react';

/** Keep device dialogs and uploads bound to the composer that opened them. */
export function useAttachmentUploadScope(conversationId?: string): () => AbortSignal {
  const controller = useRef(new AbortController());
  useLayoutEffect(() => {
    const current = new AbortController();
    controller.current = current;
    return () => current.abort();
  }, [conversationId]);
  return useCallback(() => controller.current.signal, []);
}

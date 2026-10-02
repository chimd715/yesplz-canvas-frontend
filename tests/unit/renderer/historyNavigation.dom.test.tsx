import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessageText, IMessageToolCall, TMessage } from '@/common/chat/chatLib';
import type { MessageCursorPage } from '@/common/adapter/ipcBridge';
import {
  MessageListProvider,
  MessageListLoadingProvider,
  MessagePaginationProvider,
  useMessageList,
  useMessageListLoading,
  useAddOrUpdateMessage,
  useMessagePaginationState,
} from '@/renderer/pages/conversation/Messages/hooks';

const h = vi.hoisted(() => ({
  fetch: vi.fn(),
  error: vi.fn(),
  scope: {
    current: { conversationId: 'chat', epoch: 0, active: true, window: 'latest' as 'latest' | 'first' | 'anchor' },
  },
}));
vi.mock('@/common', () => ({ ipcBridge: { database: { getConversationMessages: { invoke: h.fetch } } } }));
vi.mock('@arco-design/web-react', () => ({ Message: { error: h.error } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/renderer/pages/conversation/Messages/historyScope/useHistoryRequestScope', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/renderer/pages/conversation/Messages/historyScope/useHistoryRequestScope')
  >()),
  useHistoryRequestScope: () => h.scope,
}));
import { useHistoryNavigation } from '@/renderer/pages/conversation/Messages/historyNavigation';

const row = (id: string, content = id): IMessageText => ({
  id,
  msg_id: id,
  conversation_id: 'chat',
  type: 'text',
  position: 'left',
  content: { content },
});
const page = (ids: string[], before: boolean, after: boolean): MessageCursorPage<TMessage> => ({
  items: ids.map(row),
  oldest_cursor: ids.at(0) ?? null,
  newest_cursor: ids.at(-1) ?? null,
  has_more_before: before,
  has_more_after: after,
});
const deferred = () => {
  let resolve!: (value: MessageCursorPage<TMessage>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<MessageCursorPage<TMessage>>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { resolve, reject, promise };
};
const mount = () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MessageListLoadingProvider value={true}>
      <MessageListProvider value={[row('old-one'), row('old-two')]}>
        <MessagePaginationProvider
          value={{
            oldestCursor: 'old-one',
            newestCursor: 'old-two',
            hasMoreBefore: true,
            hasMoreAfter: true,
            isLoadingBefore: false,
            isLoadingAnchor: false,
          }}
        >
          {children}
        </MessagePaginationProvider>
      </MessageListProvider>
    </MessageListLoadingProvider>
  );
  return renderHook(
    () => ({
      nav: useHistoryNavigation('chat'),
      list: useMessageList(),
      loading: useMessageListLoading(),
      addLive: useAddOrUpdateMessage(),
      pagination: useMessagePaginationState(),
    }),
    { wrapper }
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  h.scope.current = { conversationId: 'chat', epoch: 0, active: true, window: 'latest' };
});

describe('endpoint history navigation', () => {
  it('does not fold a foreign queued tool with a reused call identity into this conversation', async () => {
    const tool: IMessageToolCall = {
      ...row('tool'),
      type: 'tool_call',
      content: { call_id: 'shared-call', name: 'Write', args: {}, status: 'running' },
    };
    const pending = deferred();
    h.fetch.mockResolvedValueOnce({ ...page([], true, false), items: [tool] }).mockReturnValueOnce(pending.promise);
    const { result } = mount();
    await act(async () => {
      await result.current.nav.jump('latest');
    });
    await act(async () => {
      result.current.addLive({
        ...tool,
        conversation_id: 'foreign-chat',
        content: { ...tool.content, status: 'error', output: 'foreign result' },
      });
      const request = result.current.nav.jump('latest');
      pending.resolve({ ...page([], true, false), items: [tool] });
      await request;
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(result.current.list).toEqual([tool]);
  });
  it.each([true, false])('keeps a pre-query queued delta once when endpoint success is %s', async (success) => {
    const pending = deferred();
    h.fetch.mockReturnValue(pending.promise);
    const { result } = mount();
    await act(async () => {
      result.current.addLive(row('old-two', ' delta'));
      const request = result.current.nav.jump('latest');
      if (success) pending.resolve({ ...page([], true, false), items: [row('old-two', 'old-two delta')] });
      else pending.reject(new Error('offline'));
      expect(await request).toBe(success);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(result.current.list.find((message) => message.id === 'old-two')?.content).toEqual({
      content: 'old-two delta',
    });
  });
  it('uses one compact bounded first read and replaces all unrelated loaded rows', async () => {
    h.fetch.mockResolvedValue(page(['first-one', 'first-two'], false, true));
    const { result } = mount();
    await act(async () => {
      expect(await result.current.nav.jump('first')).toBe(true);
    });
    expect(h.fetch).toHaveBeenCalledOnce();
    expect(h.fetch).toHaveBeenCalledWith({ conversation_id: 'chat', first: true, limit: 50, content_mode: 'compact' });
    expect(result.current.list.map((message) => message.id)).toEqual(['first-one', 'first-two']);
    expect(result.current.pagination.hasMoreBefore).toBe(false);
    expect(result.current.pagination.hasMoreAfter).toBe(true);
    expect(h.scope.current.window).toBe('first');
    expect(result.current.loading).toBe(false);
  });

  it('continues after the new window cursor and resumes latest admission at the end', async () => {
    h.fetch.mockResolvedValueOnce(page(['first'], false, true)).mockResolvedValueOnce(page(['second'], true, false));
    const { result } = mount();
    await act(async () => {
      await result.current.nav.jump('first');
    });
    await act(async () => {
      expect(await result.current.nav.loadNextPage()).toBe(true);
    });
    expect(h.fetch).toHaveBeenLastCalledWith({
      conversation_id: 'chat',
      after: 'first',
      limit: 50,
      content_mode: 'compact',
    });
    expect(result.current.list.map((message) => message.id)).toEqual(['first', 'second']);
    expect(result.current.pagination.hasMoreBefore).toBe(false);
    expect(result.current.pagination.hasMoreAfter).toBe(false);
    expect(h.scope.current.window).toBe('latest');
  });

  it('synchronously prevents duplicate endpoint requests before React renders', async () => {
    const pending = deferred();
    h.fetch.mockReturnValue(pending.promise);
    const { result } = mount();
    let first!: Promise<boolean>;
    let duplicate!: Promise<boolean>;
    act(() => {
      first = result.current.nav.jump('first');
      duplicate = result.current.nav.jump('first');
    });
    expect(await duplicate).toBe(false);
    expect(h.fetch).toHaveBeenCalledOnce();
    await act(async () => {
      pending.resolve(page(['first'], false, true));
      await first;
    });
    expect(result.current.nav.isJumping).toBe(false);
  });

  it('supersedes a delayed next-page result with an explicit latest jump', async () => {
    const pending = deferred();
    h.fetch.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(page(['latest'], true, false));
    const { result } = mount();
    let next!: Promise<boolean>;
    act(() => {
      next = result.current.nav.loadNextPage();
    });
    await act(async () => {
      await result.current.nav.jump('latest');
    });
    await act(async () => {
      pending.resolve(page(['obsolete-next'], true, true));
      expect(await next).toBe(false);
    });
    expect(result.current.list.map((message) => message.id)).toEqual(['latest']);
    expect(result.current.nav.isLoadingAfter).toBe(false);
  });

  it('discards a result after scope invalidation without touching the next conversation', async () => {
    const pending = deferred();
    h.fetch.mockReturnValue(pending.promise);
    const { result } = mount();
    let request!: Promise<boolean>;
    act(() => {
      request = result.current.nav.jump('first');
    });
    h.scope.current.active = false;
    h.scope.current = { conversationId: 'other-chat', epoch: 0, active: true, window: 'latest' };
    await act(async () => {
      pending.resolve(page(['foreign-first'], false, true));
      expect(await request).toBe(false);
    });
    expect(result.current.list.map((message) => message.id)).toEqual(['old-one', 'old-two']);
    expect(h.error).not.toHaveBeenCalled();
  });

  it('preserves rows and continuation on failure and allows an explicit retry', async () => {
    h.fetch.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(page(['first'], false, true));
    const { result } = mount();
    await act(async () => {
      expect(await result.current.nav.jump('first')).toBe(false);
    });
    expect(result.current.list.map((message) => message.id)).toEqual(['old-one', 'old-two']);
    expect(result.current.pagination.newestCursor).toBe('old-two');
    expect(result.current.nav.isJumping).toBe(false);
    expect(h.scope.current.window).toBe('latest');
    expect(h.error).toHaveBeenCalledWith('messages.historyNavigationFailed');
    await act(async () => {
      expect(await result.current.nav.jump('first')).toBe(true);
    });
  });

  it('keeps earlier-window live admission while a latest jump is pending or fails', async () => {
    const pending = deferred();
    h.fetch.mockResolvedValueOnce(page(['first'], false, true)).mockReturnValueOnce(pending.promise);
    const { result } = mount();
    await act(async () => {
      await result.current.nav.jump('first');
    });
    let request!: Promise<boolean>;
    act(() => {
      request = result.current.nav.jump('latest');
    });
    expect(h.scope.current.window).toBe('first');
    act(() => result.current.addLive(row('unrelated-live-tail')));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(result.current.list.map((message) => message.id)).toEqual(['first']);
    await act(async () => {
      pending.reject(new Error('offline'));
      expect(await request).toBe(false);
    });
    expect(result.current.list.map((message) => message.id)).toEqual(['first']);
    expect(h.scope.current.window).toBe('first');
    expect(result.current.pagination.newestCursor).toBe('first');
  });

  it('keeps a completed same-call live result over an older latest snapshot', async () => {
    const pending = deferred();
    const running: IMessageToolCall = {
      ...row('running'),
      type: 'tool_call',
      content: { call_id: 'call', name: 'Write', args: { path: 'sample.md' }, status: 'running' },
    };
    const completed: IMessageToolCall = {
      ...running,
      id: 'completed',
      content: { ...running.content, status: 'completed', output: 'saved', args: null },
    };
    h.fetch.mockResolvedValueOnce({ ...page([], true, false), items: [running] }).mockReturnValueOnce(pending.promise);
    const { result } = mount();
    await act(async () => {
      await result.current.nav.jump('latest');
    });
    let request!: Promise<boolean>;
    act(() => {
      request = result.current.nav.jump('latest');
      result.current.addLive(completed);
    });
    await act(async () => {
      pending.resolve({ ...page([], true, false), items: [{ ...running, id: 'persisted' }] });
      await request;
    });
    expect(result.current.list).toHaveLength(1);
    expect(result.current.list[0].content).toMatchObject({
      status: 'completed',
      output: 'saved',
      args: { path: 'sample.md' },
    });
  });

  it.each(['latest', 'after', 'first'] as const)(
    'recovers final live frames rejected by an earlier window during %s transition',
    async (transition) => {
      const pending = deferred();
      h.fetch.mockResolvedValueOnce(page(['first'], false, true)).mockReturnValueOnce(pending.promise);
      const { result } = mount();
      await act(async () => {
        await result.current.nav.jump('first');
      });
      let request!: Promise<boolean>;
      act(() => {
        request = transition === 'after' ? result.current.nav.loadNextPage() : result.current.nav.jump(transition);
        result.current.addLive(row('final-live', 'final answer'));
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(result.current.list.map((message) => message.id)).toEqual(['first']);
      await act(async () => {
        pending.resolve(page(['persisted-tail'], true, false));
        await request;
      });
      expect(result.current.list.map((message) => message.id)).toContain('final-live');
      expect(result.current.list.find((message) => message.id === 'final-live')?.content).toEqual({
        content: 'final answer',
      });
      expect(h.scope.current.window).toBe('latest');
      if (transition === 'latest') expect(result.current.list.map((message) => message.id)).not.toContain('first');
    }
  );

  it.each(['latest', 'after', 'first'] as const)(
    'applies captured text and thinking chunks once when %s resolves before the live flush',
    async (transition) => {
      const pending = deferred();
      h.fetch.mockResolvedValueOnce(page(['first'], false, true)).mockReturnValueOnce(pending.promise);
      const { result } = mount();
      await act(async () => {
        await result.current.nav.jump('first');
      });
      await act(async () => {
        const request =
          transition === 'after' ? result.current.nav.loadNextPage() : result.current.nav.jump(transition);
        result.current.addLive(row('tail', 'chunk'));
        result.current.addLive({ ...row('thought'), type: 'thinking', content: { content: 'thought chunk' } });
        pending.resolve(page(['persisted-tail'], true, false));
        await request;
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(result.current.list.find((message) => message.id === 'tail')?.content).toEqual({ content: 'chunk' });
      expect(result.current.list.find((message) => message.id === 'thought')?.content).toMatchObject({
        content: 'thought chunk',
      });
    }
  );
});

import { act, renderHook } from '@testing-library/react';
import type { KeyboardEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { getActiveExplicitSkillQuery } from '@/common/chat/slash/explicitSkills';
import { useSlashCommandController } from '@/renderer/hooks/chat/useSlashCommandController';

const commands = [
  { name: 'report', description: 'Reports', kind: 'template' as const, source: 'skill' as const },
  { name: 'review', description: 'Review', kind: 'template' as const, source: 'skill' as const },
];
const key = (name: string, value?: string, selectionStart?: number) =>
  ({
    key: name,
    preventDefault: vi.fn(),
    currentTarget: value === undefined ? undefined : { value, selectionStart },
  }) as unknown as KeyboardEvent;

describe('dollar skill autocomplete keyboard behavior', () => {
  it('uses the live text/caret on fast Enter and inserts a selection instead of submitting raw input', () => {
    const select = vi.fn();
    const { result } = renderHook(() =>
      useSlashCommandController({
        input: '',
        commands,
        matchInput: getActiveExplicitSkillQuery,
        onSelectTemplate: select,
      })
    );
    act(() => expect(result.current.onKeyDown(key('Enter', 'Use $repo later', 9))).toBe(true));
    expect(select).toHaveBeenCalledWith('report', 'Use $repo later', 9);
  });
  it('navigates all available skills and accepts Tab, preserving Escape dismissal', () => {
    const select = vi.fn();
    const { result } = renderHook(() =>
      useSlashCommandController({
        input: '$',
        commands,
        matchInput: getActiveExplicitSkillQuery,
        onSelectTemplate: select,
      })
    );
    act(() => {
      result.current.onKeyDown(key('ArrowDown'));
    });
    act(() => {
      result.current.onKeyDown(key('Tab'));
    });
    expect(select.mock.calls[0][0]).toBe('review');
    expect(result.current.isOpen).toBe(false);
  });
  it('does not consume Enter for unknown names or code literals', () => {
    const select = vi.fn();
    const { result } = renderHook(() =>
      useSlashCommandController({
        input: '$missing',
        commands,
        matchInput: getActiveExplicitSkillQuery,
        onSelectTemplate: select,
      })
    );
    expect(result.current.onKeyDown(key('Enter', '$missing', 8))).toBe(false);
    expect(result.current.onKeyDown(key('Enter', '`$report`', 5))).toBe(false);
    expect(select).not.toHaveBeenCalled();
  });
});

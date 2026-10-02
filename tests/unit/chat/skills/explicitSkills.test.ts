import { describe, expect, it } from 'vitest';
import {
  getActiveExplicitSkillQuery,
  insertExplicitSkill,
  parseExplicitSkillNames,
  unknownExplicitSkills,
} from '@/common/chat/slash/explicitSkills';

describe('explicit skill syntax', () => {
  it('deduplicates exact names in prose without interpreting currency, escapes, code or embedded identifiers', () => {
    expect(
      parseExplicitSkillNames(
        'Use $report then "$build-doc" and $report. $42 cost email$bad \\$literal `$code`\n```sh\n$hidden\n```\n$final_skill'
      )
    ).toEqual(['report', 'build-doc', 'final_skill']);
  });
  it('reports unavailable names rather than choosing a similar skill', () => {
    expect(unknownExplicitSkills('$reports $report', [{ name: 'report' }])).toEqual(['reports']);
    expect(unknownExplicitSkills('$report', undefined)).toEqual(['report']);
  });
  it('opens an empty dollar query and filters at the actual caret inside a token', () => {
    expect(getActiveExplicitSkillQuery('$')).toBe('');
    expect(getActiveExplicitSkillQuery('Use $ later', 5)).toBe('');
    expect(getActiveExplicitSkillQuery('Use $report later', 7)).toBe('re');
    expect(getActiveExplicitSkillQuery('Use $report later')).toBeNull();
    expect(getActiveExplicitSkillQuery('`$report`', 4)).toBeNull();
  });
  it('replaces the whole active token without losing surrounding text and positions the caret after the separator', () => {
    expect(insertExplicitSkill('Use $repo later', 'report', 7)).toEqual({ value: 'Use $report later', caret: 12 });
    expect(insertExplicitSkill('$re', 'report')).toEqual({ value: '$report ', caret: 8 });
    expect(insertExplicitSkill('unchanged', 'report')).toEqual({ value: 'unchanged', caret: 9 });
  });
});

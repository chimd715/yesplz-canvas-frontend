import { describe, expect, it } from 'vitest';
import { getPromptBudget } from '@/common/utils/modelCapabilities';

describe('service prompt admission', () => {
  it.each(['deepseek/deepseek-v4.1-flash', 'z-ai/glm-5.3', 'z-ai/glm-5.3-flash'])(
    'accepts the boundary and rejects one extra encoded byte for %s',
    (use_model) => {
      const maximum = getPromptBudget('', { use_model }).maxBytes;
      expect(getPromptBudget('a'.repeat(maximum - 2), { use_model }).allowed).toBe(true);
      expect(getPromptBudget('a'.repeat(maximum - 1), { use_model }).allowed).toBe(false);
    }
  );

  it('accounts for multibyte text, escaped control characters, attachments and prior context', () => {
    expect(getPromptBudget('한').usedBytes).toBe(5);
    expect(getPromptBudget('\u0000').usedBytes).toBe(8);
    const model = { use_model: 'z-ai/glm-5.3' };
    expect(getPromptBudget('', model, 2, 1000).maxBytes).toBe(getPromptBudget('', model).maxBytes - 9192);
  });

  it('a provider limit can lower but cannot raise the catalog window and unknown models have a finite fallback', () => {
    const model = { use_model: 'z-ai/glm-5.3', context_limit: 1_000_000 };
    expect(getPromptBudget('', model).maxBytes).toBe(getPromptBudget('', { use_model: model.use_model }).maxBytes);
    expect(getPromptBudget('', { ...model, context_limit: 65536 }).maxBytes).toBe(32768);
    expect(getPromptBudget('x'.repeat(300_000)).allowed).toBe(false);
  });

  it.each([0, -1, Number.NaN])('treats invalid provider context %s as missing metadata', (context_limit) => {
    expect(getPromptBudget('Hello', { use_model: 'unknown', context_limit })).toEqual(getPromptBudget('Hello'));
  });
});

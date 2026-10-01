import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  creationCatalogSchema,
  creationModeSnapshot,
  fetchCreationModes,
} from '@/renderer/pages/guid/utils/creationModes';
import { widgetModeFixture } from '../../../fixtures/creationMode';

describe('creation mode catalog', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('distinguishes a missing standalone catalog from failures and empty publications', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ revision: 2, modes: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchCreationModes('/api/platform/creation-modes')).resolves.toBeNull();
    await expect(fetchCreationModes('/api/platform/creation-modes')).rejects.toThrow();
    await expect(fetchCreationModes('/api/platform/creation-modes')).resolves.toEqual({ revision: 2, modes: [] });
  });

  it('pins the published instructions and skill revisions independently of later catalog edits', () => {
    const mode = { ...widgetModeFixture, skillRefs: [{ id: 'widget', revision: 3 }], mcpRefs: ['products'] };
    const pinned = creationModeSnapshot(mode, 3);
    mode.instructions = 'Changed draft';
    mode.skillRefs[0].revision = 4;
    mode.mcpRefs.push('orders');
    expect(pinned.instructions).not.toBe('Changed draft');
    expect(pinned.skillRefs).toEqual([{ id: 'widget', revision: 3 }]);
    expect(pinned.mcpRefs).toEqual(['products']);
  });

  it('rejects unsafe remote or non-PNG icons at the catalog boundary', () => {
    for (const icon of ['https://external.example/icon.png', 'data:image/svg+xml;base64,PHN2Zz4=']) {
      expect(creationCatalogSchema.safeParse({ revision: 1, modes: [{ ...widgetModeFixture, icon }] }).success).toBe(
        false
      );
    }
  });

  it('accepts the platform prompt limit and instructions composed from multiple managed skills', () => {
    const mode = {
      ...widgetModeFixture,
      instructions: Array.from({ length: 8 }, () => 'x'.repeat(32000)).join('\n\n'),
      prompts: [{ id: 'example', title: 'Example', description: '', prompt: 'x'.repeat(32000), icon: null }],
      runtimeSkillRefs: ['native_skill.v2'],
    };
    expect(creationCatalogSchema.safeParse({ revision: 1, modes: [mode] }).success).toBe(true);
    mode.prompts[0].prompt += 'x';
    expect(creationCatalogSchema.safeParse({ revision: 1, modes: [mode] }).success).toBe(false);
  });

  it('defaults legacy cards to prompt and rejects unsupported types', () => {
    const card = { id: 'example', title: 'Example', description: '', prompt: 'Build a widget', icon: null };
    const parse = (type?: string) =>
      creationCatalogSchema.safeParse({
        revision: 1,
        modes: [{ ...widgetModeFixture, prompts: [{ ...card, ...(type ? { type } : {}) }] }],
      });
    const legacy = parse();
    const prompt = parse('prompt');
    expect(legacy.success && legacy.data.modes[0].prompts[0].type).toBe('prompt');
    expect(prompt.success && prompt.data.modes[0].prompts[0].type).toBe('prompt');
    expect(parse('remix').success).toBe(false);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  creationCatalogSchema,
  creationModeSnapshot,
  fetchCreationModes,
  standaloneWidgetMode,
} from '@/renderer/pages/guid/utils/creationModes';

describe('creation mode catalog', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses standalone fallback only for an unavailable platform route, not failures or empty published lists', async () => {
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
    const mode = { ...standaloneWidgetMode, skillRefs: [{ id: 'widget', revision: 3 }], mcpRefs: ['products'] };
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
      expect(creationCatalogSchema.safeParse({ revision: 1, modes: [{ ...standaloneWidgetMode, icon }] }).success).toBe(
        false
      );
    }
  });
});

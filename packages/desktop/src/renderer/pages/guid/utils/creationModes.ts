import type { TCreationModeSnapshot } from '@/common/config/storage';
import { z } from 'zod';

// Keep these wire limits aligned with platform infra/catalog/model.ts. A resolved
// mode can contain every skill in the 900 KiB stored catalog, not just one skill.
const MAX_CATALOG_BYTES = 900 * 1024;
const MAX_ICON_BYTES = 128 * 1024;
const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => !value.includes('\0'));
const requiredText = (max: number) => text(max).refine((value) => !!value.trim());
const id = requiredText(96).refine((value) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value));
const toolRef = requiredText(128).refine(
  (value) => value === value.trim() && [...value].every((char) => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127)
);
const icon = z
  .string()
  .max(22 + 4 * Math.ceil(MAX_ICON_BYTES / 3))
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/)
  .nullable();
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const creationModeSchema = z.object({
  id,
  name: requiredText(120),
  description: text(2000),
  placeholder: text(2000),
  instructions: text(MAX_CATALOG_BYTES),
  prompts: z
    .array(
      z.object({
        id,
        type: z.literal('prompt').default('prompt'),
        title: requiredText(120),
        description: text(2000),
        prompt: requiredText(32000),
        icon,
      })
    )
    .max(20),
  runtimeSkillRefs: z.array(toolRef).max(100),
  mcpRefs: z.array(toolRef).max(100),
  outputType: requiredText(64).refine((value) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)),
  isDefault: z.boolean(),
  icon,
  skillRefs: z.array(z.object({ id, revision })).max(100),
});
export const creationCatalogSchema = z.object({
  revision: revision.nullable(),
  modes: z.array(creationModeSchema).max(50),
});
export type CreationMode = z.infer<typeof creationModeSchema>;
export type CreationCatalog = z.infer<typeof creationCatalogSchema>;

export async function fetchCreationModes(path: string): Promise<CreationCatalog | null> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  // Standalone Core has no catalog. It offers ordinary chat, without built-in modes.
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Creation modes could not be loaded');
  return creationCatalogSchema.parse(await response.json());
}

/** Freeze the published instructions used to start this conversation. */
export function creationModeSnapshot(mode: CreationMode, catalogRevision: number | null): TCreationModeSnapshot {
  return {
    id: mode.id,
    revision: catalogRevision,
    name: mode.name,
    instructions: mode.instructions,
    skillRefs: mode.skillRefs.map((ref) => ({ id: ref.id, revision: ref.revision })),
    runtimeSkillRefs: [...mode.runtimeSkillRefs],
    mcpRefs: [...mode.mcpRefs],
    outputType: mode.outputType,
  };
}

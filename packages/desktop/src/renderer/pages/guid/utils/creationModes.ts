import type { TCreationModeSnapshot } from '@/common/config/storage';
import { z } from 'zod';
import shopWidgetSkill from './shop-widget.md?raw';

const id = z.string().min(1).max(200);
const icon = z
  .string()
  .max(180000)
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/)
  .nullable();
const revision = z.number().int().nonnegative();
const creationModeSchema = z.object({
  id,
  name: z.string().min(1).max(200),
  description: z.string().max(2000),
  placeholder: z.string().max(2000),
  instructions: z.string().max(200000),
  prompts: z
    .array(
      z.object({
        id,
        title: z.string().min(1).max(200),
        description: z.string().max(2000),
        prompt: z.string().min(1).max(20000),
        icon,
      })
    )
    .max(100),
  runtimeSkillRefs: z.array(id).max(100),
  mcpRefs: z.array(id).max(100),
  outputType: z.string().max(100),
  isDefault: z.boolean(),
  icon,
  skillRefs: z.array(z.object({ id, revision })).max(100),
});
export const creationCatalogSchema = z.object({
  revision: revision.nullable(),
  modes: z.array(creationModeSchema).max(100),
});
export type CreationMode = z.infer<typeof creationModeSchema>;
export type CreationCatalog = z.infer<typeof creationCatalogSchema>;

/** Standalone Core has no platform catalog; hosted empty catalogs stay empty. */
export const standaloneWidgetMode: CreationMode = {
  id: 'shop-widget',
  name: 'Build ecommerce widget',
  description: 'Embeddable widget, live preview, and installation code.',
  placeholder: 'Describe the widget you want to add to your store',
  instructions: shopWidgetSkill.trim(),
  prompts: [],
  runtimeSkillRefs: ['yesplz-api'],
  mcpRefs: ['yesplz-api-reference'],
  outputType: 'widget',
  isDefault: true,
  icon: null,
  skillRefs: [],
};

export async function fetchCreationModes(path: string): Promise<CreationCatalog | null> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
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

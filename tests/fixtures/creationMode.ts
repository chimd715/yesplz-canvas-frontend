import type { CreationMode } from '@/renderer/pages/guid/utils/creationModes';

/** Server-owned published mode fixture; no product instructions live in the renderer. */
export const widgetModeFixture: CreationMode = {
  id: 'shop-widget',
  name: 'Shop Widget',
  description: 'An installable store widget',
  placeholder: 'Describe your widget',
  instructions: 'Published widget instructions from the platform catalog.',
  items: [],
  runtimeSkillRefs: ['yesplz-api'],
  mcpRefs: ['yesplz-api-reference'],
  outputType: 'widget',
  isDefault: true,
  icon: null,
  skillRefs: [{ id: 'widget-guide', revision: 1 }],
};

export const catalogFixture = { revision: 1, modes: [widgetModeFixture] };

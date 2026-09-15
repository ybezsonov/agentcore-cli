import type { TemplateProfile } from './profiles';

/** Spring AI agents are Java on a Container build. Bedrock is the only model provider so far. */
export const SPRING_TEMPLATE_PROFILE: TemplateProfile = {
  requiredOptions: { build: 'Container', language: 'Java' },
  defaultOptions: { modelProvider: 'Bedrock' },
};

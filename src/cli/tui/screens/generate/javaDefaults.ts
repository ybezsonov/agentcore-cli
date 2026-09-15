import type { GenerateConfig } from './types';

/**
 * The wizard config after the user picks Java: Spring AI on a Container build with Bedrock and no memory.
 * Java has no filesystem mounts or config bundle, so values chosen before switching language are dropped.
 */
export function applyJavaWizardDefaults(config: GenerateConfig): GenerateConfig {
  return {
    ...config,
    language: 'Java',
    buildType: 'Container',
    protocol: 'HTTP',
    sdk: 'SpringAI',
    modelProvider: 'Bedrock',
    memory: 'none',
    sessionStorageMountPath: undefined,
    efsAccessPoints: undefined,
    s3AccessPoints: undefined,
    withConfigBundle: undefined,
  };
}

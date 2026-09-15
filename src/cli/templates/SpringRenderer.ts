import { BaseRenderer } from './BaseRenderer';
import { TEMPLATE_ROOT } from './templateRoot';
import type { AgentRenderConfig } from './types';

/** Renderer for Java / Spring AI AgentCore agents. */
export class SpringRenderer extends BaseRenderer {
  constructor(config: AgentRenderConfig) {
    super(config, 'spring', TEMPLATE_ROOT, config.protocol ?? 'http');
  }
}

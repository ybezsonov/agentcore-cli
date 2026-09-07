import { BaseRenderer } from './BaseRenderer';
import { TEMPLATE_ROOT } from './templateRoot';
import type { AgentRenderConfig } from './types';

/**
 * Renderer for Java / Spring AI AgentCore agents. Templates live under
 * assets/java/<protocol>/spring/. Java agents are Container-only (the Dockerfile builds the jar);
 * the runtime contract (/invocations + /ping) is provided by spring-ai-agentcore-runtime-starter.
 */
export class SpringRenderer extends BaseRenderer {
  constructor(config: AgentRenderConfig) {
    super(config, 'spring', TEMPLATE_ROOT, config.protocol ?? 'http');
  }
}

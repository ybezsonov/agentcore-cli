import { APP_DIR } from '../../lib';
import { BaseRenderer, type RendererContext } from './BaseRenderer';
import { copyAndRenderDir } from './render';
import { TEMPLATE_ROOT } from './templateRoot';
import type { AgentRenderConfig } from './types';
import Handlebars from 'handlebars';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

const DEFAULT_MODEL_MAX_TOKENS = 4096;

// Escapes a value for a Java .properties line so Spring Boot reads back the exact text. The
// properties loader reads ISO-8859-1, so non-ASCII is written as a \uXXXX escape. A '${' gets two
// backslashes: the loader keeps one, and Spring's placeholder resolver reads '\${' as literal text.
Handlebars.registerHelper('escapeProps', (value: unknown) => {
  const s = typeof value === 'string' ? value : '';
  return new Handlebars.SafeString(
    s
      .replace(/\\/g, '\\\\')
      .replace(/\$\{/g, '\\\\${')
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t')
      .replace(/\f/g, '\\f')
      .replace(/^ /, '\\ ')
      .replace(/[^\x20-\x7e]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
  );
});

/** Renderer for Java / Spring AI AgentCore agents. */
export class SpringRenderer extends BaseRenderer {
  constructor(config: AgentRenderConfig) {
    super(
      {
        ...config,
        modelMaxTokens: config.modelMaxTokens ?? DEFAULT_MODEL_MAX_TOKENS,
        systemPrompt: config.systemPrompt ?? `You are a helpful assistant for ${config.name}.`,
      },
      'spring',
      TEMPLATE_ROOT,
      config.protocol ?? 'http'
    );
  }

  /** Java capabilities carry their own src/main/... layout, so render() puts them at the project root. */
  protected override shouldRenderMemory(): boolean {
    return false;
  }

  /** Java enforces only the timeout. Export notes cover maxIterations and maxTokens. */
  protected override shouldRenderExecutionLimits(): boolean {
    return this.config.timeoutSeconds !== undefined;
  }

  override async render(context: RendererContext): Promise<void> {
    await super.render(context);

    const { hasMemory, hasGateway, hasSkillsFetcher } = this.config;
    const capabilities: [string, boolean | undefined][] = [
      ['env-bridge', hasMemory || hasGateway],
      ['memory', hasMemory],
      ['gateway', hasGateway],
      ['skills', hasSkillsFetcher],
    ];
    const projectDir = path.join(context.outputDir, APP_DIR, this.config.name);
    const templateData = { ...this.config, ...context, projectName: this.config.name, Name: this.config.name };
    for (const [capability, enabled] of capabilities) {
      const capabilityDir = path.join(this.getTemplateDir(), 'capabilities', capability);
      if (enabled && existsSync(capabilityDir)) {
        await copyAndRenderDir(capabilityDir, projectDir, templateData);
      }
    }
  }
}

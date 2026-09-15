import { APP_DIR } from '../../lib';
import { copyAndRenderDir } from './render';
import type { AgentRenderConfig } from './types';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

export interface RendererContext {
  outputDir: string;
}

type TemplateData = AgentRenderConfig &
  RendererContext & {
    projectName: string;
    Name: string;
  };

export abstract class BaseRenderer {
  protected readonly config: AgentRenderConfig;
  protected readonly sdkName: string;
  protected readonly baseTemplateDir: string;
  protected readonly protocolMode: string;

  protected constructor(config: AgentRenderConfig, sdkName: string, baseTemplateDir: string, protocolMode?: string) {
    this.config = config;
    this.sdkName = sdkName;
    this.baseTemplateDir = baseTemplateDir;
    this.protocolMode = (protocolMode ?? config.protocol ?? 'HTTP').toLowerCase();
  }

  protected shouldRenderMemory(): boolean {
    return this.config.hasMemory;
  }

  protected shouldRenderPayment(): boolean {
    return this.config.hasPayment;
  }

  protected shouldRenderExecutionLimits(): boolean {
    return !!(this.config.maxIterations ?? this.config.maxTokens ?? this.config.timeoutSeconds);
  }

  protected getTemplateDir(): string {
    const language = this.config.targetLanguage.toLowerCase();
    return path.join(this.baseTemplateDir, language, this.protocolMode, this.sdkName);
  }

  async render(context: RendererContext): Promise<void> {
    const templateDir = this.getTemplateDir();
    const projectName = this.config.name;
    // Agents are placed in app/<agentName>/ directory
    const projectDir = path.join(context.outputDir, APP_DIR, projectName);

    const templateData: TemplateData = {
      ...this.config,
      ...context,
      projectName,
      Name: projectName,
    };

    // Always render base template
    const baseDir = path.join(templateDir, 'base');
    await copyAndRenderDir(baseDir, projectDir, templateData);

    // Java capability templates carry their full src/main/... layout and render at the project root.
    // Existing Python/TypeScript memory templates retain their memory/ package destination.
    if (this.config.hasMemory || this.config.hasGateway) {
      await this.renderCapability(templateDir, projectDir, templateData, 'env-bridge');
    }
    if (this.shouldRenderMemory()) {
      await this.renderCapability(templateDir, projectDir, templateData, 'memory', 'memory');
    }
    if (this.config.hasGateway) {
      await this.renderCapability(templateDir, projectDir, templateData, 'gateway');
    }
    if (this.config.hasSkillsFetcher) {
      await this.renderCapability(templateDir, projectDir, templateData, 'skills');
    }

    if (this.shouldRenderPayment()) {
      const paymentCapabilityDir = path.join(templateDir, 'capabilities', 'payments');
      if (existsSync(paymentCapabilityDir)) {
        const capabilitiesDir = path.join(projectDir, 'capabilities');
        mkdirSync(capabilitiesDir, { recursive: true });
        const capInitPath = path.join(capabilitiesDir, '__init__.py');
        if (!existsSync(capInitPath)) writeFileSync(capInitPath, '');
        const paymentTargetDir = path.join(capabilitiesDir, 'payments');
        await copyAndRenderDir(paymentCapabilityDir, paymentTargetDir, templateData);
      }
    }

    const shouldRenderExecutionLimits =
      this.config.targetLanguage === 'Java'
        ? this.config.timeoutSeconds !== undefined
        : this.shouldRenderExecutionLimits();
    if (shouldRenderExecutionLimits) {
      await this.renderCapability(templateDir, projectDir, templateData, 'execution-limits');
    }

    // Generate Dockerfile and .dockerignore for Container builds
    if (this.config.buildType === 'Container') {
      const language = this.config.targetLanguage.toLowerCase();
      const containerTemplateDir = path.join(this.baseTemplateDir, 'container', language);

      if (existsSync(containerTemplateDir)) {
        const exclude = this.config.dockerfile ? new Set(['Dockerfile']) : undefined;
        await copyAndRenderDir(
          containerTemplateDir,
          projectDir,
          { ...templateData, entrypoint: 'main', enableOtel: this.config.enableOtel ?? true },
          { exclude }
        );
      }
    }
  }

  private async renderCapability(
    templateDir: string,
    projectDir: string,
    templateData: TemplateData,
    capability: string,
    subdir?: string
  ): Promise<void> {
    const capabilityDir = path.join(templateDir, 'capabilities', capability);
    if (!existsSync(capabilityDir)) return;

    const targetDir = this.config.targetLanguage !== 'Java' && subdir ? path.join(projectDir, subdir) : projectDir;
    await copyAndRenderDir(capabilityDir, targetDir, templateData);
  }
}

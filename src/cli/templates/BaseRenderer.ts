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

    // Render capability templates that exist for this SDK (renderCapability no-ops when the SDK ships
    // no dir for it — e.g. Python/TS express memory/gateway/skills inline in their base template). The
    // Java-layout-vs-subdirectory choice (Q1, review/6-rfc-open-questions.md) is centralized in
    // renderCapability: memory/gateway pass a subdir for Python/TS; the Java-only capabilities
    // (remote-mcp/truncation/skills/execution-limits) pass none and always render into projectDir.
    if (this.shouldRenderMemory()) {
      await this.renderCapability(templateDir, projectDir, templateData, 'memory', 'memory');
    }
    if (this.config.hasGateway) {
      await this.renderCapability(templateDir, projectDir, templateData, 'gateway', 'gateway');
    }
    if (this.config.hasRemoteMcpHeaderAuth) {
      // Only remote MCP servers with header credentials need the RemoteMcpConfig customizer; URL-only
      // servers are wired via application.properties + the shared MCP client.
      await this.renderCapability(templateDir, projectDir, templateData, 'remote-mcp');
    }
    if (this.config.hasSessionTruncation) {
      // Truncation → AgentCore Session API read-window (SDK 2.2+); the mapper gates it on memory.
      await this.renderCapability(templateDir, projectDir, templateData, 'truncation');
    }
    if (this.config.hasSkillsFetcher) {
      // Path skills staged into src/main/resources/skills/ by the export action; surfaced by the
      // community SkillsTool (spring-ai-agent-utils) via a ToolCallbackProvider the base composes.
      await this.renderCapability(templateDir, projectDir, templateData, 'skills');
    }
    if (this.shouldRenderExecutionLimits()) {
      await this.renderCapability(templateDir, projectDir, templateData, 'execution-limits');
    }

    // Payments is the one capability whose Python/TS layout differs (nested under a capabilities/
    // package with an __init__.py), so it stays an explicit case rather than using renderCapability.
    if (this.shouldRenderPayment()) {
      const paymentCapabilityDir = path.join(templateDir, 'capabilities', 'payments');
      if (existsSync(paymentCapabilityDir)) {
        if (this.config.targetLanguage === 'Java') {
          await copyAndRenderDir(paymentCapabilityDir, projectDir, templateData);
        } else {
          const capabilitiesDir = path.join(projectDir, 'capabilities');
          mkdirSync(capabilitiesDir, { recursive: true });
          const capInitPath = path.join(capabilitiesDir, '__init__.py');
          if (!existsSync(capInitPath)) writeFileSync(capInitPath, '');
          const paymentTargetDir = path.join(capabilitiesDir, 'payments');
          await copyAndRenderDir(paymentCapabilityDir, paymentTargetDir, templateData);
        }
      }
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

  /**
   * Render a capability's template into the project when it exists for this SDK.
   *
   * Java capability templates carry their own `src/main/java/<package>/` path and merge into the
   * project source tree, so they render into `projectDir`. For Python/TS, a capability with a
   * dedicated template dir renders into a named `subdir` (a Python package / TS module); a capability
   * that only exists for Java passes no `subdir` and renders into `projectDir`. No-ops when the SDK
   * ships no directory for the capability (the `existsSync` guard).
   */
  private async renderCapability(
    templateDir: string,
    projectDir: string,
    templateData: TemplateData,
    capability: string,
    subdir?: string
  ): Promise<void> {
    const capabilityDir = path.join(templateDir, 'capabilities', capability);
    if (!existsSync(capabilityDir)) return;
    const isJavaLayout = this.config.targetLanguage === 'Java';
    const targetDir = !isJavaLayout && subdir ? path.join(projectDir, subdir) : projectDir;
    await copyAndRenderDir(capabilityDir, targetDir, templateData);
  }
}

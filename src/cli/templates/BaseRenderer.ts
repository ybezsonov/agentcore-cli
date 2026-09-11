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

    // Render capability templates based on config.
    // Only render if the capability directory exists (not all SDKs have all capabilities).
    // Java capabilities carry their own src/main/java/<package>/ path and merge into the project
    // source tree, so they render into projectDir; Python/TS capabilities render into a
    // capability subdirectory (a Python package / TS module).
    // TODO(java-rfc Q1): revisit this per-language conditional — a uniform "render into projectDir,
    // dest path lives inside the capability template" model would drop it but restructures the
    // Python/TS capability dirs. See review/6-rfc-open-questions.md.
    const isJavaLayout = this.config.targetLanguage === 'Java';

    if (this.shouldRenderMemory()) {
      const memoryCapabilityDir = path.join(templateDir, 'capabilities', 'memory');
      if (existsSync(memoryCapabilityDir)) {
        const memoryTargetDir = isJavaLayout ? projectDir : path.join(projectDir, 'memory');
        await copyAndRenderDir(memoryCapabilityDir, memoryTargetDir, templateData);
      }
    }

    // Gateway (MCP tools) capability. Python/TS express this inline in their base template, so they
    // ship no capabilities/gateway dir and the existsSync guard skips them; only Java carries a
    // gateway capability tree (its files live under src/main/java/<package>/ and merge into the
    // project source, so they render into projectDir).
    if (this.config.hasGateway) {
      const gatewayCapabilityDir = path.join(templateDir, 'capabilities', 'gateway');
      if (existsSync(gatewayCapabilityDir)) {
        const gatewayTargetDir = isJavaLayout ? projectDir : path.join(projectDir, 'gateway');
        await copyAndRenderDir(gatewayCapabilityDir, gatewayTargetDir, templateData);
      }
    }

    // Remote (non-gateway) MCP header-auth capability (Java export only). URL-only remote MCP servers
    // are wired purely via application.properties + the shared MCP client; only servers with header
    // credentials need the RemoteMcpConfig customizer, so this renders solely when header auth exists.
    // Python/TS ship no capabilities/remote-mcp dir (existsSync skips them); its files live under
    // src/main/java/<package>/ and merge into the project source, so they render into projectDir.
    if (this.config.hasRemoteMcpHeaderAuth) {
      const remoteMcpCapabilityDir = path.join(templateDir, 'capabilities', 'remote-mcp');
      if (existsSync(remoteMcpCapabilityDir)) {
        await copyAndRenderDir(remoteMcpCapabilityDir, projectDir, templateData);
      }
    }

    if (this.shouldRenderPayment()) {
      const paymentCapabilityDir = path.join(templateDir, 'capabilities', 'payments');
      if (existsSync(paymentCapabilityDir)) {
        if (isJavaLayout) {
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

    if (this.shouldRenderExecutionLimits()) {
      const limitsCapabilityDir = path.join(templateDir, 'capabilities', 'execution-limits');
      if (existsSync(limitsCapabilityDir)) {
        await copyAndRenderDir(limitsCapabilityDir, projectDir, templateData);
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
}

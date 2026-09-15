import { SpringRenderer } from '../SpringRenderer.js';
import type { AgentRenderConfig } from '../types.js';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ASSETS_ROOT = resolve(__dirname, '..', '..', '..', 'assets');

const fullConfig: AgentRenderConfig = {
  name: 'refagent',
  sdkFramework: 'SpringAI',
  targetLanguage: 'Java',
  modelProvider: 'Bedrock',
  protocol: 'HTTP',
  buildType: 'Container',
  hasMemory: true,
  hasIdentity: false,
  hasGateway: true,
  hasPayment: false,
  isVpc: false,
  memoryProviders: [{ name: 'refmem', envVarName: 'MEMORY_REFMEM_ID', strategies: [] }],
  identityProviders: [],
  gatewayProviders: [{ name: 'refgw', envVarName: 'AGENTCORE_GATEWAY_REFGW_URL', authType: 'AWS_IAM' }],
  gatewayAuthTypes: ['AWS_IAM'],
  remoteMcpTools: [{ name: 'docs', url: 'https://example.com/mcp' }],
  hasSkillsFetcher: true,
  timeoutSeconds: 60,
  hasExecutionLimits: true,
  hasBrowser: true,
  hasCodeInterpreter: true,
  modelId: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',
  modelMaxTokens: 4096,
  systemPrompt: 'You are a helpful assistant for refagent.',
  enableOtel: false,
};

function templateFiles(root: string, current: string = root): string[] {
  return readdirSync(current, { withFileTypes: true }).flatMap(entry => {
    const path = join(current, entry.name);
    return entry.isDirectory() ? templateFiles(root, path) : [relative(root, path)];
  });
}

function renderedName(path: string): string {
  return path
    .replace(/(^|\/)gitignore\.template$/, '$1.gitignore')
    .replace(/(^|\/)dockerignore\.template$/, '$1.dockerignore');
}

describe('SpringRenderer', () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = mkdtempSync(join(tmpdir(), 'spring-renderer-'));
  });

  afterEach(() => {
    rmSync(outputDir, { recursive: true, force: true });
  });

  it('renders the full Java capability layout with one EPP registration', async () => {
    await new SpringRenderer(fullConfig).render({ outputDir });
    const project = join(outputDir, 'app', 'refagent');
    const factories = readFileSync(join(project, 'src/main/resources/META-INF/spring.factories'), 'utf-8')
      .split('\n')
      .filter(Boolean);

    expect(factories).toEqual([
      'org.springframework.boot.EnvironmentPostProcessor=com.example.agent.AgentCoreEnvironmentPostProcessor',
    ]);
    expect(readFileSync(join(project, 'src/main/java/com/example/agent/ChatService.java'), 'utf-8')).toContain(
      '"default-session"'
    );
    expect(readFileSync(join(project, 'src/main/resources/application.properties'), 'utf-8')).toContain(
      'connections.docs.url=https://example.com/mcp'
    );
  });

  it('bounds streaming reads and ends a failed stream with an error chunk', async () => {
    await new SpringRenderer(fullConfig).render({ outputDir });
    const project = join(outputDir, 'app', 'refagent');
    const properties = readFileSync(join(project, 'src/main/resources/application.properties'), 'utf-8');
    const chatService = readFileSync(join(project, 'src/main/java/com/example/agent/ChatService.java'), 'utf-8');

    expect(properties).toContain('spring.ai.bedrock.aws.async-read-timeout=120s');
    expect(chatService).toContain('.onErrorResume(error -> Flux.just(ChatChunk.ofError(error)))');
    expect(chatService).toContain('@JsonInclude(JsonInclude.Include.NON_NULL)');
    expect(chatService).toContain('public record ChatChunk(String text, String error)');
  });

  it('answers unknown tool names with a tool error instead of failing the turn', async () => {
    await new SpringRenderer(fullConfig).render({ outputDir });
    const project = join(outputDir, 'app', 'refagent');
    const properties = readFileSync(join(project, 'src/main/resources/application.properties'), 'utf-8');
    const config = readFileSync(join(project, 'src/main/java/com/example/agent/UnknownToolConfig.java'), 'utf-8');

    expect(properties).toContain('spring.ai.tools.resolution.fallback.enabled=true');
    expect(config).toContain('ToolCallbackResolver toolCallbackResolver()');
    expect(config).toContain('return UnknownToolCallback::new;');
  });

  it('renders no APIs deprecated for removal in Spring AI 2.0 or AWS SDK 2.54', async () => {
    await new SpringRenderer(fullConfig).render({ outputDir });
    const project = join(outputDir, 'app', 'refagent');
    const sources = templateFiles(project)
      .filter(file => file.endsWith('.java'))
      .map(file => readFileSync(join(project, file), 'utf-8'))
      .join('\n');

    expect(sources).not.toMatch(/\bChatClientCustomizer\b/);
    expect(sources).not.toContain('.defaultToolCallbacks(');
    expect(sources).not.toContain('DefaultCredentialsProvider.create()');
    expect(sources).toContain('ChatClientBuilderCustomizer');
  });

  it('takes the memory actor only from the runtime user-id header', async () => {
    await new SpringRenderer(fullConfig).render({ outputDir });
    const agent = join(outputDir, 'app', 'refagent', 'src/main/java/com/example/agent');
    const chatService = readFileSync(join(agent, 'ChatService.java'), 'utf-8');
    const chatRequest = readFileSync(join(agent, 'ChatRequest.java'), 'utf-8');

    expect(chatService).toContain(
      'String actor = firstNonBlank(context.getHeader(AgentCoreHeaders.USER_ID), "default-user");'
    );
    expect(chatService).not.toContain('request.userId');
    expect(chatRequest).toContain('public record ChatRequest(String prompt)');
    expect(chatRequest).not.toContain('user_id');
  });

  it('has no destination collisions across selected asset owners', () => {
    const owners = [
      ['base', join(ASSETS_ROOT, 'java/http/spring/base')],
      ['env-bridge', join(ASSETS_ROOT, 'java/http/spring/capabilities/env-bridge')],
      ['memory', join(ASSETS_ROOT, 'java/http/spring/capabilities/memory')],
      ['gateway', join(ASSETS_ROOT, 'java/http/spring/capabilities/gateway')],
      ['skills', join(ASSETS_ROOT, 'java/http/spring/capabilities/skills')],
      ['execution-limits', join(ASSETS_ROOT, 'java/http/spring/capabilities/execution-limits')],
      ['container', join(ASSETS_ROOT, 'container/java')],
    ] as const;
    const destinations = new Map<string, string[]>();

    for (const [owner, root] of owners) {
      for (const file of templateFiles(root)) {
        const destination = renderedName(file);
        destinations.set(destination, [...(destinations.get(destination) ?? []), owner]);
      }
    }

    expect([...destinations.entries()].filter(([, fileOwners]) => fileOwners.length > 1)).toEqual([]);
    expect(destinations.get('src/main/resources/META-INF/spring.factories')).toEqual(['env-bridge']);
  });
});

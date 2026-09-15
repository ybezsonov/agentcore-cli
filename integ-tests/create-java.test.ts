import { exists, prereqs, readProjectConfig, runCLI, runFailure, runSuccess } from '../src/test-utils/index.js';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const JAVA_SOURCES = 'src/main/java/com/example/agent';

describe.skipIf(!prereqs.npm || !prereqs.git)('integration: Java / Spring AI agents', () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = join(tmpdir(), `agentcore-integ-java-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('creates a Java agent with Container build, HTTP protocol, and memory', async () => {
    const name = `Java${Date.now().toString().slice(-6)}`;
    const json = await runSuccess(
      ['create', '--name', name, '--language', 'Java', '--memory', 'longAndShortTerm', '--json'],
      testDir
    );
    const projectPath = json.projectPath as string;
    const agentDir = join(projectPath, 'app', name);

    for (const file of [
      'pom.xml',
      'Dockerfile',
      `${JAVA_SOURCES}/ChatService.java`,
      `${JAVA_SOURCES}/UnknownToolConfig.java`,
      `${JAVA_SOURCES}/memory/MemoryConfig.java`,
    ]) {
      expect(await exists(join(agentDir, file)), `${file} should exist`).toBe(true);
    }
    expect(await exists(join(agentDir, 'pyproject.toml')), 'no Python project files').toBe(false);

    const pom = await readFile(join(agentDir, 'pom.xml'), 'utf-8');
    expect(pom).toContain('spring-ai-starter-model-bedrock-converse');
    expect(pom).toContain('spring-ai-agentcore-memory');

    const config = await readProjectConfig(projectPath);
    const runtimes = config.runtimes as Record<string, unknown>[];
    expect(runtimes).toHaveLength(1);
    expect(runtimes[0]).toMatchObject({ name, build: 'Container', entrypoint: 'main.py' });
    const memories = config.memories as Record<string, unknown>[];
    expect(memories.map(memory => memory.name)).toEqual([`${name}Memory`]);
  });

  it('adds a Java agent with a custom system prompt and an AWS_IAM gateway client', async () => {
    const project = `JavaAdd${Date.now().toString().slice(-6)}`;
    const created = await runSuccess(['create', '--name', project, '--no-agent', '--skip-git', '--json'], testDir);
    const projectPath = created.projectPath as string;

    await runSuccess(
      ['add', 'gateway', '--name', 'tools-gw', '--protocol-type', 'MCP', '--authorizer-type', 'AWS_IAM', '--json'],
      projectPath
    );
    const prompt = 'You are a travel planner. Cite your sources.';
    await runSuccess(
      ['add', 'agent', '--name', 'Planner', '--language', 'Java', '--system-prompt', prompt, '--json'],
      projectPath
    );

    const agentDir = join(projectPath, 'app', 'Planner');
    expect(await exists(join(agentDir, `${JAVA_SOURCES}/mcp/McpConfig.java`)), 'McpConfig.java should exist').toBe(
      true
    );
    const properties = await readFile(join(agentDir, 'src/main/resources/application.properties'), 'utf-8');
    expect(properties).toContain(`agent.system-prompt=${prompt}`);
    const mcpConfig = await readFile(join(agentDir, `${JAVA_SOURCES}/mcp/McpConfig.java`), 'utf-8');
    expect(mcpConfig).toContain('Set.of("tools-gw")');
  });

  it.each([
    [['--build', 'CodeZip'], '--build CodeZip is not supported for Java agents'],
    [['--protocol', 'MCP'], 'MCP protocol is not yet supported for Java agents'],
    [['--framework', 'Strands'], 'Framework Strands is not yet available for Java agents'],
    [['--model-provider', 'OpenAI', '--api-key', 'sk-test'], 'OpenAI model provider is not yet supported'],
    [['--with-config-bundle'], '--with-config-bundle is not supported for Java agents'],
  ])('rejects create --language Java %j', async (flags, message) => {
    const json = await runFailure(
      ['create', '--name', `Rej${Date.now().toString().slice(-6)}`, '--language', 'Java', ...flags, '--json'],
      testDir
    );
    expect(String(json.error)).toContain(message);
  });

  it('rejects --system-prompt for a Python agent', async () => {
    const project = `PyRej${Date.now().toString().slice(-6)}`;
    const created = await runSuccess(['create', '--name', project, '--no-agent', '--skip-git', '--json'], testDir);
    const json = await runFailure(
      [
        'add',
        'agent',
        '--name',
        'PyAgent',
        '--language',
        'Python',
        '--framework',
        'Strands',
        '--model-provider',
        'Bedrock',
        '--system-prompt',
        'Hello',
        '--json',
      ],
      created.projectPath as string
    );
    expect(String(json.error)).toContain('--system-prompt is supported only when creating a Java agent');
  });

  it('rejects a CUSTOM_JWT gateway when adding a Java agent', async () => {
    const project = `JwtRej${Date.now().toString().slice(-6)}`;
    const created = await runSuccess(['create', '--name', project, '--no-agent', '--skip-git', '--json'], testDir);
    const projectPath = created.projectPath as string;
    const gateway = await runCLI(
      [
        'add',
        'gateway',
        '--name',
        'jwt-gw',
        '--authorizer-type',
        'CUSTOM_JWT',
        '--discovery-url',
        'https://example.com/.well-known/openid-configuration',
        '--allowed-audience',
        'aud',
        '--json',
      ],
      projectPath
    );
    expect(gateway.exitCode, `stderr: ${gateway.stderr}`).toBe(0);

    const json = await runFailure(['add', 'agent', '--name', 'JavaJwt', '--language', 'Java', '--json'], projectPath);
    expect(String(json.error)).toContain('Java agents support only AWS_IAM gateways');
  });
});

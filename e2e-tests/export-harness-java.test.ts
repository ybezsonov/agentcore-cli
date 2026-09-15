/**
 * E2E: export a fully-featured harness to a standalone Java (Spring AI) runtime agent, both
 * in-project (--name) and out-of-project (--arn), and prove each exported agent works at runtime.
 *
 * Mirrors export-harness-full.test.ts with the Java export path:
 *   - the gateway uses --protocol-type MCP (the gateway type the Java agent's MCP client supports)
 *   - the harness pins --model-id to a model enabled in the test account
 *   - export runs with --language Java --framework SpringAI
 *   - the in-project memory wiring is checked in AgentCoreEnvironmentPostProcessor.java
 *
 * Flow:
 *   1. create a project-only scaffold (--no-agent) + add a memory and an MCP gateway (mcp-server target)
 *   2. deploy #1 — provisions the memory + gateway
 *   3. create the harness attaching the memory (by name) + gateway (by --gateway-arn), plus a
 *      code-interpreter tool and a public git skill; deploy #2
 *   4. invoke the harness and verify the code interpreter runs
 *   5. export --name to a Java runtime agent in the SAME project; deploy; verify capabilities
 *   6. in a NEW empty project, export --arn to a Java runtime agent; deploy; verify capabilities
 *
 * Two projects are torn down in afterAll. Requires: AWS credentials, npm, git.
 */
import { hasAwsCredentials, parseJsonOutput, prereqs, retry } from '../src/test-utils/index.js';
import { installCdkTarball, runAgentCoreCLI, teardownE2EProject, writeAwsTargets } from './e2e-helper.js';
import { getLogger } from './utils/logger.js';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const hasAws = hasAwsCredentials();
const canRun = prereqs.npm && prereqs.git && hasAws;

const PUBLIC_GIT_SKILL = 'https://github.com/strands-agents/samples';
const PUBLIC_GIT_SKILL_PATH = 'python/01-learn/15-skills/skills/returns-policy';
const PUBLIC_MCP_ENDPOINT = 'https://mcp.exa.ai/mcp';
const MODEL_ID = 'global.anthropic.claude-sonnet-4-5-20250929-v1:0';

const logger = getLogger('export-harness-java');

interface InvokeJson {
  success: boolean;
  response?: string;
  error?: unknown;
}

interface DeployedState {
  targets?: {
    default?: {
      resources?: {
        gateways?: Record<string, { gatewayArn?: string }>;
        mcp?: { gateways?: Record<string, { gatewayArn?: string }> };
        memories?: Record<string, { memoryArn?: string }>;
        harnesses?: Record<string, { harnessArn?: string }>;
      };
    };
  };
}

async function readDeployedState(projectPath: string): Promise<DeployedState> {
  return JSON.parse(await readFile(join(projectPath, 'agentcore', '.cli', 'deployed-state.json'), 'utf-8'));
}

async function deploy(projectPath: string, label: string): Promise<void> {
  await retry(
    async () => {
      const result = await runAgentCoreCLI(['deploy', '--yes', '--json'], projectPath);
      expect(result.exitCode, `${label} failed: stderr=${result.stderr}, stdout=${result.stdout}`).toBe(0);
      expect((parseJsonOutput(result.stdout) as { success: boolean }).success).toBe(true);
    },
    2,
    30000
  );
}

/**
 * Invoke (harness or runtime) with retries; assert success and return the parsed response. The
 * optional `verify` predicate runs inside the retried unit, so a content check that fails on one
 * LLM sample or one memory read re-invokes instead of failing the test.
 */
async function invokeAndExpectSuccess(
  args: string[],
  projectPath: string,
  verify?: (json: InvokeJson) => void,
  attempts = 3
): Promise<InvokeJson> {
  return retry(
    async () => {
      const result = await runAgentCoreCLI(args, projectPath);
      expect(result.exitCode, `Invoke failed: stderr=${result.stderr}, stdout=${result.stdout}`).toBe(0);
      const json = parseJsonOutput(result.stdout) as InvokeJson;
      expect(json.success, `Invoke should report success; got: ${JSON.stringify(json)}`).toBe(true);
      expect(json.response ?? '', `Agent returned an error: ${json.response}`).not.toMatch(/^Error:/);
      verify?.(json);
      return json;
    },
    attempts,
    15000
  );
}

/**
 * Verify that an exported Java runtime agent can use each capability at runtime:
 *   - code interpreter: compute a factorial and assert the exact value
 *   - MCP gateway tool: list tools and assert an Exa or gateway-prefixed tool name is present
 *   - skill: ask for its skills and assert the git-cloned returns-policy skill is referenced
 *   - memory: a same-session round trip (state a fact, then recall it)
 */
async function verifyExportedAgentCapabilities(
  agentName: string,
  projectPath: string,
  factorial: { prompt: string; expected: string }
): Promise<void> {
  const invoke = (prompt: string, verify?: (json: InvokeJson) => void, sessionId?: string): Promise<InvokeJson> =>
    invokeAndExpectSuccess(
      [
        'invoke',
        '--runtime',
        agentName,
        ...(sessionId ? ['--session-id', sessionId] : []),
        '--prompt',
        prompt,
        '--json',
      ],
      projectPath,
      verify
    );

  await invoke(factorial.prompt, json =>
    expect(json.response ?? '', `Expected ${factorial.expected} in response; got: ${json.response}`).toContain(
      factorial.expected
    )
  );

  await invoke('List the exact names of every tool you can call. Reply with the names only.', json =>
    expect(
      /mcp_?gw|_exa|exa_/.test((json.response ?? '').toLowerCase()),
      `Agent should list a gateway-provided MCP tool (Exa / gateway-prefixed); got: ${json.response}`
    ).toBe(true)
  );

  await invoke('What specialized skills do you have? Name them briefly.', json =>
    expect(
      /return|refund|warranty|returns-policy/.test((json.response ?? '').toLowerCase()),
      `Agent should reference the returns-policy skill; got: ${json.response}`
    ).toBe(true)
  );

  // Session id must be >=33 chars (service constraint) and unique per run.
  const sessionId = `e2e-export-java-mem-${agentName}-roundtrip-${Date.now()}`;
  await invoke('My favorite color is teal. Please remember it.', undefined, sessionId);
  await invoke(
    'What is my favorite color? Answer with just the color.',
    json =>
      expect(
        (json.response ?? '').toLowerCase(),
        `Agent should recall "teal" from memory; got: ${json.response}`
      ).toContain('teal'),
    sessionId
  );
}

describe.sequential('e2e: export fully-featured harness to Java — in-project + out-of-project', () => {
  let testDir: string;
  let projectPath: string;
  let outDir: string;
  let outProjectPath: string;
  let harnessName: string;
  let projectName: string;
  let outProjectName: string;
  let harnessArn: string;
  let gatewayArn: string;
  const gatewayName = 'expgw';
  const memoryName = 'HarnessMem';
  const codeToolName = 'codeRunner';
  const gatewayToolName = 'mcpGw';
  const inProjectAgent = 'InProjJavaAgent';
  const outProjectAgent = 'OutProjJavaAgent';

  if (!canRun) {
    logger.warn(`tests skipped: npm=${prereqs.npm}, git=${prereqs.git}, hasAws=${hasAws}`);
  }

  beforeAll(async () => {
    if (!canRun) return;

    testDir = join(tmpdir(), `agentcore-e2e-expj-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
    // The `E2e` prefix lets global-setup's stale-stack GC collect orphans (`AgentCore-E2e*`).
    const runSuffix = String(Date.now()).slice(-8);
    harnessName = `E2eExpJ${runSuffix}`;
    projectName = `E2eExpJSrc${runSuffix}`;
    outProjectName = `E2eExpJOut${runSuffix}`;

    const create = await runAgentCoreCLI(
      ['create', '--project-name', projectName, '--no-agent', '--json', '--skip-git'],
      testDir
    );
    expect(create.exitCode, `Create failed: ${create.stderr}`).toBe(0);
    projectPath = (parseJsonOutput(create.stdout) as { projectPath: string }).projectPath;

    const addMemory = await runAgentCoreCLI(
      ['add', 'memory', '--name', memoryName, '--strategies', 'SEMANTIC', '--json'],
      projectPath
    );
    expect(addMemory.exitCode, `add memory failed: ${addMemory.stderr}`).toBe(0);

    const addGw = await runAgentCoreCLI(
      ['add', 'gateway', '--name', gatewayName, '--protocol-type', 'MCP', '--authorizer-type', 'AWS_IAM', '--json'],
      projectPath
    );
    expect(addGw.exitCode, `add gateway failed: ${addGw.stderr}`).toBe(0);

    const addTarget = await runAgentCoreCLI(
      [
        'add',
        'gateway-target',
        '--name',
        'exatarget',
        '--gateway',
        gatewayName,
        '--type',
        'mcp-server',
        '--endpoint',
        PUBLIC_MCP_ENDPOINT,
        '--json',
      ],
      projectPath
    );
    expect(addTarget.exitCode, `add gateway-target failed: ${addTarget.stderr}`).toBe(0);

    await writeAwsTargets(projectPath);
    installCdkTarball(projectPath);
  }, 300000);

  afterAll(async () => {
    // The two projects are independent stacks, so tear them down in parallel.
    if (hasAws) {
      await Promise.all([
        projectPath ? teardownE2EProject(projectPath, harnessName, 'bedrock').catch(() => undefined) : undefined,
        outProjectPath
          ? teardownE2EProject(outProjectPath, outProjectAgent, 'bedrock').catch(() => undefined)
          : undefined,
      ]);
    }
    if (testDir) await rm(testDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 1000 });
    if (outDir) await rm(outDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 1000 });
  }, 1200000);

  it.skipIf(!canRun)(
    'deploy #1 provisions the memory and gateway',
    async () => {
      await deploy(projectPath, 'Deploy #1');

      const resources = (await readDeployedState(projectPath)).targets?.default?.resources;
      const gateways = { ...(resources?.gateways ?? {}), ...(resources?.mcp?.gateways ?? {}) };
      expect(gateways[gatewayName]?.gatewayArn, 'Gateway ARN should be in deployed state').toBeTruthy();
      gatewayArn = gateways[gatewayName]!.gatewayArn!;
      expect(resources?.memories?.[memoryName]?.memoryArn, 'Memory ARN should be in deployed state').toBeTruthy();
    },
    900000
  );

  it.skipIf(!canRun)(
    'create the harness attaching the memory + gateway + tools + skill, then deploy #2',
    async () => {
      expect(gatewayArn, 'Gateway ARN should have been captured from deploy #1').toBeTruthy();

      const addHarness = await runAgentCoreCLI(
        [
          'add',
          'harness',
          '--name',
          harnessName,
          '--model-provider',
          'bedrock',
          '--model-id',
          MODEL_ID,
          '--memory-name',
          memoryName,
          '--memory-actor-id',
          'user-1',
          '--json',
        ],
        projectPath
      );
      expect(addHarness.exitCode, `add harness failed: stderr=${addHarness.stderr}, stdout=${addHarness.stdout}`).toBe(
        0
      );

      const addTool = await runAgentCoreCLI(
        [
          'add',
          'tool',
          '--harness',
          harnessName,
          '--type',
          'agentcore_code_interpreter',
          '--name',
          codeToolName,
          '--json',
        ],
        projectPath
      );
      expect(addTool.exitCode, `add code-interpreter tool failed: ${addTool.stderr}`).toBe(0);

      const addSkill = await runAgentCoreCLI(
        [
          'add',
          'skill',
          '--harness',
          harnessName,
          '--git',
          PUBLIC_GIT_SKILL,
          '--git-path',
          PUBLIC_GIT_SKILL_PATH,
          '--json',
        ],
        projectPath
      );
      expect(addSkill.exitCode, `add git skill failed: ${addSkill.stderr}`).toBe(0);

      const addGwTool = await runAgentCoreCLI(
        [
          'add',
          'tool',
          '--harness',
          harnessName,
          '--type',
          'agentcore_gateway',
          '--name',
          gatewayToolName,
          '--gateway-arn',
          gatewayArn,
          '--outbound-auth',
          'awsIam',
          '--json',
        ],
        projectPath
      );
      expect(
        addGwTool.exitCode,
        `add gateway tool failed: stderr=${addGwTool.stderr}, stdout=${addGwTool.stdout}`
      ).toBe(0);

      const spec = JSON.parse(await readFile(join(projectPath, 'app', harnessName, 'harness.json'), 'utf-8')) as {
        model?: { modelId?: string };
        memory?: { name?: string };
        tools?: { type: string }[];
        skills?: unknown[];
      };
      const toolTypes = (spec.tools ?? []).map(t => t.type);
      expect(toolTypes, `Harness should have both tools; got: ${toolTypes.join(', ')}`).toEqual(
        expect.arrayContaining(['agentcore_code_interpreter', 'agentcore_gateway'])
      );
      expect(spec.model?.modelId, 'Harness should use the pinned model').toBe(MODEL_ID);
      expect(spec.memory?.name, 'Harness should reference the memory by name').toBe(memoryName);
      expect(spec.skills?.length, 'Harness should have the git skill').toBeGreaterThan(0);

      await deploy(projectPath, 'Deploy #2');

      const harnessEntry = (await readDeployedState(projectPath)).targets?.default?.resources?.harnesses?.[harnessName];
      expect(harnessEntry?.harnessArn, 'Harness ARN should be in deployed state').toBeTruthy();
      harnessArn = harnessEntry!.harnessArn!;
    },
    900000
  );

  it.skipIf(!canRun)(
    'invokes the source harness and runs the code interpreter',
    async () => {
      await invokeAndExpectSuccess(
        [
          'invoke',
          '--harness',
          harnessName,
          '--prompt',
          'Use your code interpreter to compute 6 factorial. Reply with just the number.',
          '--json',
        ],
        projectPath,
        json => expect(json.response ?? '', `Expected 720 in response; got: ${json.response}`).toContain('720')
      );
    },
    240000
  );

  it.skipIf(!canRun)(
    'exports the harness in-project to a Java runtime agent',
    async () => {
      const result = await runAgentCoreCLI(
        [
          'export',
          'harness',
          '--name',
          harnessName,
          '--target-agent-name',
          inProjectAgent,
          '--language',
          'Java',
          '--framework',
          'SpringAI',
          '--json',
        ],
        projectPath
      );
      expect(result.exitCode, `In-project export failed: stderr=${result.stderr}, stdout=${result.stdout}`).toBe(0);
      expect((parseJsonOutput(result.stdout) as { success: boolean }).success).toBe(true);

      const cfg = JSON.parse(await readFile(join(projectPath, 'agentcore', 'agentcore.json'), 'utf-8')) as {
        runtimes: { name: string; connections?: { to: { type: string } }[] }[];
        memories?: { name: string }[];
      };
      // The MCP gateway is recorded under deployed-state `mcp.gateways`, so the mapper wires it as a
      // same-project gateway (McpConfig + implicit URL env var), not as a connection. The managed
      // code interpreter is always a connection.
      const agent = cfg.runtimes.find(r => r.name === inProjectAgent);
      expect(agent, `Exported runtime "${inProjectAgent}" should be in agentcore.json`).toBeDefined();
      const types = (agent!.connections ?? []).map(c => c.to.type);
      expect(types, `Expected only a codeInterpreter connection; got: ${types.join(', ')}`).toEqual([
        'codeInterpreter',
      ]);
      expect(
        cfg.memories?.some(m => m.name === memoryName),
        `Project memory "${memoryName}" should remain`
      ).toBe(true);

      // The generated Java agent maps the in-project memory discovery env var to its memory ID.
      const agentDir = join(projectPath, 'app', inProjectAgent);
      const javaDir = join(agentDir, 'src', 'main', 'java', 'com', 'example', 'agent');
      const envBridge = await readFile(join(javaDir, 'AgentCoreEnvironmentPostProcessor.java'), 'utf-8');
      expect(envBridge, 'Env bridge should read the memory discovery env var').toContain(
        `MEMORY_${memoryName.toUpperCase()}_ID`
      );
      const pom = await readFile(join(agentDir, 'pom.xml'), 'utf-8');
      expect(pom, 'pom.xml should include the code-interpreter starter').toContain(
        'spring-ai-agentcore-code-interpreter'
      );
      await expect(readFile(join(javaDir, 'mcp', 'McpConfig.java'), 'utf-8')).resolves.toContain(`"${gatewayName}"`);
    },
    120000
  );

  it.skipIf(!canRun)(
    'deploys the in-project Java agent and verifies all capabilities at runtime',
    async () => {
      await deploy(projectPath, 'In-project export deploy');
      await verifyExportedAgentCapabilities(inProjectAgent, projectPath, {
        prompt: 'Use your code interpreter to compute 5 factorial. Reply with just the number.',
        expected: '120',
      });
    },
    900000
  );

  it.skipIf(!canRun)(
    'exports the harness by ARN into a new empty project as a Java agent',
    async () => {
      expect(harnessArn, 'Harness ARN should have been captured from deploy #2').toBeTruthy();

      outDir = join(tmpdir(), `agentcore-e2e-expj-out-${randomUUID()}`);
      await mkdir(outDir, { recursive: true });

      const create = await runAgentCoreCLI(
        ['create', '--project-name', outProjectName, '--no-agent', '--json', '--skip-git'],
        outDir
      );
      expect(create.exitCode, `Out-of-project create failed: ${create.stderr}`).toBe(0);
      outProjectPath = (parseJsonOutput(create.stdout) as { projectPath: string }).projectPath;

      await writeAwsTargets(outProjectPath);
      installCdkTarball(outProjectPath);

      const result = await runAgentCoreCLI(
        [
          'export',
          'harness',
          '--arn',
          harnessArn,
          '--target-agent-name',
          outProjectAgent,
          '--language',
          'Java',
          '--framework',
          'SpringAI',
          '--json',
        ],
        outProjectPath
      );
      expect(result.exitCode, `--arn export failed: stderr=${result.stderr}, stdout=${result.stdout}`).toBe(0);
      expect((parseJsonOutput(result.stdout) as { success: boolean }).success).toBe(true);

      const cfg = JSON.parse(await readFile(join(outProjectPath, 'agentcore', 'agentcore.json'), 'utf-8')) as {
        runtimes: { name: string; connections?: { to: { type: string } }[] }[];
      };
      const agent = cfg.runtimes.find(r => r.name === outProjectAgent);
      expect(agent, `Exported runtime "${outProjectAgent}" should be in agentcore.json`).toBeDefined();
      const types = (agent!.connections ?? []).map(c => c.to.type);
      expect(types, `Expected memory + gateway + codeInterpreter connections; got: ${types.join(', ')}`).toEqual(
        expect.arrayContaining(['codeInterpreter', 'gateway', 'memory'])
      );
    },
    180000
  );

  it.skipIf(!canRun)(
    'deploys the out-of-project Java agent and verifies all capabilities at runtime',
    async () => {
      await deploy(outProjectPath, 'Out-of-project deploy');
      await verifyExportedAgentCapabilities(outProjectAgent, outProjectPath, {
        prompt: 'Use your code interpreter to compute 7 factorial. Reply with just the number.',
        expected: '5040',
      });
    },
    900000
  );
});

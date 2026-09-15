/**
 * E2E: export a fully-featured harness to a standalone Java (Spring AI) runtime agent, both in-project
 * (--name) and out-of-project (--arn), and prove each exported agent works at runtime. It follows
 * export-harness-full.test.ts (the Python export). The Java gateway uses --protocol-type MCP, the
 * gateway type the Java agent's MCP client supports.
 *
 * The source harness exercises every export surface together:
 *   - an existing project memory referenced by name (in-project export wires it via a discovery env
 *     var; out-of-project export resolves its ARN and wires it as a memory connection)
 *   - an agentcore_code_interpreter tool (managed default; exported as a codeInterpreter connection)
 *   - a public GitHub skill (no credential)
 *   - an MCP gateway tool (in-project gateway + mcp-server target)
 *
 * Flow:
 *   1. create a project-only scaffold (--no-agent) + add a memory and a gateway (mcp-server target)
 *   2. deploy #1 — provisions the memory + gateway (both ARNs now exist in deployed-state)
 *   3. create the harness attaching the deployed memory (by name) + gateway (by --gateway-arn),
 *      plus a code-interpreter tool and a public git skill; deploy #2
 *   4. invoke the HARNESS and verify the code interpreter runs
 *   5. export --name → a runtime agent in the SAME project; deploy; invoke; verify
 *   6. in a NEW empty project, export --arn (the deployed harness); deploy; invoke; verify
 *      (every resource is external here → memory + gateway + code-interpreter all wired as connections)
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

// A public, anonymous-cloneable GitHub repo + subdirectory holding a valid skill (must contain a
// SKILL.md).
const PUBLIC_GIT_SKILL = 'https://github.com/strands-agents/samples';
const PUBLIC_GIT_SKILL_PATH = 'python/01-learn/15-skills/skills/returns-policy';
// A reachable public MCP server endpoint for the gateway target.
const PUBLIC_MCP_ENDPOINT = 'https://mcp.exa.ai/mcp';

/** What the in-project export check receives. */
interface InProjectExport {
  /** Connection target types on the exported runtime in agentcore.json. */
  connectionTypes: string[];
  /** The exported agent's code directory (app/<agent>). */
  agentDir: string;
  memoryName: string;
  gatewayName: string;
}

/** Per-language settings for the shared export suite. */
interface ExportHarnessVariant {
  /** Logger name and describe title. */
  name: string;
  title: string;
  /** Short tag in stack, harness and temp-dir names; must start with `Exp` (see the `E2e` prefix note). */
  resourceTag: string;
  inProjectAgent: string;
  outProjectAgent: string;
  /** Extra `export harness` args, e.g. `['--language', 'Java', '--framework', 'SpringAI']`. */
  exportArgs: string[];
  /** Protocol type of the in-project gateway. */
  gatewayProtocol: 'None' | 'MCP';
  /** Asserts the in-project export's connections and generated code. */
  verifyInProjectExport: (exported: InProjectExport) => Promise<void>;
}

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
  return JSON.parse(
    await readFile(join(projectPath, 'agentcore', '.cli', 'deployed-state.json'), 'utf-8')
  ) as DeployedState;
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
 * LLM sample (nondeterministic phrasing) or one read (memory write/read lag) re-invokes instead of
 * failing the test.
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
 * Verify that an exported runtime agent can use each capability at runtime, not just that it is in
 * the spec:
 *   - code interpreter: compute a factorial and assert the exact value (the model can't fabricate it)
 *   - MCP gateway tool: list tools and assert a gateway-provided tool is present by its name prefix
 *     (mcpGw -> `mcp_gw_*`) or the Exa `_exa` token — provider-specific, not generic prose words
 *   - skill: ask what skills are loaded and assert the git-cloned `returns-policy` skill is referenced
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
      `Agent should list a gateway-provided MCP tool (mcpGw-prefixed / Exa); got: ${json.response}`
    ).toBe(true)
  );

  await invoke('What specialized skills do you have? Name them briefly.', json =>
    expect(
      /return|refund|warranty|returns-policy/.test((json.response ?? '').toLowerCase()),
      `Agent should reference the returns-policy skill; got: ${json.response}`
    ).toBe(true)
  );

  // Session id must be >=33 chars (service constraint) and unique per run. Turn 1 just needs to
  // succeed; the recall turn retries its content assertion (the write may lag the read).
  const sessionId = `e2e-export-mem-${agentName}-roundtrip-${Date.now()}`;
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

function createExportHarnessSuite(v: ExportHarnessVariant): void {
  const hasAws = hasAwsCredentials();
  const canRun = prereqs.npm && prereqs.git && hasAws;
  const logger = getLogger(v.name);
  const tmpTag = v.resourceTag.toLowerCase();

  describe.sequential(v.title, () => {
    let testDir: string;
    let projectPath: string; // source project (harness + in-project export)
    let outDir: string;
    let outProjectPath: string; // separate project for the --arn export
    let harnessName: string;
    let projectName: string;
    let outProjectName: string;
    let harnessArn: string;
    let gatewayArn: string;
    const gatewayName = 'expgw';
    const memoryName = 'HarnessMem';
    const codeToolName = 'codeRunner';
    const gatewayToolName = 'mcpGw';

    if (!canRun) {
      logger.warn(`tests skipped: npm=${prereqs.npm}, git=${prereqs.git}, hasAws=${hasAws}`);
    }

    beforeAll(async () => {
      if (!canRun) return;

      testDir = join(tmpdir(), `agentcore-e2e-${tmpTag}-${randomUUID()}`);
      await mkdir(testDir, { recursive: true });
      // Per-run suffix so project (= stack) names are unique across concurrent/repeated runs. The
      // `E2e` prefix is required: global-setup's stale-stack GC only collects stacks named
      // `AgentCore-E2e*`, so any orphan left by a failed teardown is still swept on the next run.
      const runSuffix = String(Date.now()).slice(-8);
      harnessName = `E2e${v.resourceTag}${runSuffix}`;
      projectName = `E2e${v.resourceTag}Src${runSuffix}`;
      outProjectName = `E2e${v.resourceTag}Out${runSuffix}`;

      // 1. A project-only scaffold (no agent) plus the resources the harness will attach. These are
      //    deployed FIRST (deploy #1) so they have concrete ARNs.
      const create = await runAgentCoreCLI(
        ['create', '--project-name', projectName, '--no-agent', '--json', '--skip-git'],
        testDir
      );
      expect(create.exitCode, `Create failed: ${create.stderr}`).toBe(0);
      projectPath = (parseJsonOutput(create.stdout) as { projectPath: string }).projectPath;

      // 1a. A project memory (existing, by name) — has a concrete ARN the export can resolve. (Managed
      // memory's ARN only exists service-side in get-harness, so it is not resolvable by --name export.)
      const addMemory = await runAgentCoreCLI(
        ['add', 'memory', '--name', memoryName, '--strategies', 'SEMANTIC', '--json'],
        projectPath
      );
      expect(addMemory.exitCode, `add memory failed: ${addMemory.stderr}`).toBe(0);

      // 1b. A gateway + mcp-server target (public endpoint, self-contained).
      const addGw = await runAgentCoreCLI(
        [
          'add',
          'gateway',
          '--name',
          gatewayName,
          '--protocol-type',
          v.gatewayProtocol,
          '--authorizer-type',
          'AWS_IAM',
          '--json',
        ],
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
          // Outbound auth defaults to NONE when omitted; passing `--outbound-auth none` currently trips
          // a credential-required check (the flag value is lowercased but validated against 'NONE').
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
            ? teardownE2EProject(outProjectPath, v.outProjectAgent, 'bedrock').catch(() => undefined)
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

        // A `None` gateway is recorded under `resources.gateways`, an `MCP` one under `resources.mcp.gateways`.
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
            '--memory-name',
            memoryName,
            '--memory-actor-id',
            'user-1',
            '--json',
          ],
          projectPath
        );
        expect(
          addHarness.exitCode,
          `add harness failed: stderr=${addHarness.stderr}, stdout=${addHarness.stdout}`
        ).toBe(0);

        // Code-interpreter tool (managed default — no external ARN).
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

        // Public GitHub skill (anonymous clone), pointing at a subdir containing SKILL.md.
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

        // Gateway tool referencing the already-deployed gateway by ARN.
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

        // `add tool` only fails at synth/deploy for some misconfigurations, so assert the local spec
        // is complete before deploying.
        const spec = JSON.parse(await readFile(join(projectPath, 'app', harnessName, 'harness.json'), 'utf-8')) as {
          memory?: { name?: string };
          tools?: { type: string }[];
          skills?: unknown[];
        };
        const toolTypes = (spec.tools ?? []).map(t => t.type);
        expect(toolTypes, `Harness should have both tools; got: ${toolTypes.join(', ')}`).toEqual(
          expect.arrayContaining(['agentcore_code_interpreter', 'agentcore_gateway'])
        );
        expect(spec.memory?.name, 'Harness should reference the memory by name').toBe(memoryName);
        expect(spec.skills?.length, 'Harness should have the git skill').toBeGreaterThan(0);

        await deploy(projectPath, 'Deploy #2');

        // The harness ARN must now exist for the out-of-project (--arn) export.
        const harnessEntry = (await readDeployedState(projectPath)).targets?.default?.resources?.harnesses?.[
          harnessName
        ];
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
      'exports the harness in-project to a runtime agent',
      async () => {
        const result = await runAgentCoreCLI(
          [
            'export',
            'harness',
            '--name',
            harnessName,
            '--target-agent-name',
            v.inProjectAgent,
            ...v.exportArgs,
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
        const agent = cfg.runtimes.find(r => r.name === v.inProjectAgent);
        expect(agent, `Exported runtime "${v.inProjectAgent}" should be in agentcore.json`).toBeDefined();
        // The project memory is still present (the exported runtime accesses it via in-project wiring).
        expect(
          cfg.memories?.some(m => m.name === memoryName),
          `Project memory "${memoryName}" should remain`
        ).toBe(true);

        await v.verifyInProjectExport({
          connectionTypes: (agent!.connections ?? []).map(c => c.to.type),
          agentDir: join(projectPath, 'app', v.inProjectAgent),
          memoryName,
          gatewayName,
        });
      },
      120000
    );

    it.skipIf(!canRun)(
      'deploys the in-project exported agent and verifies all capabilities at runtime',
      async () => {
        await deploy(projectPath, 'In-project export deploy');
        await verifyExportedAgentCapabilities(v.inProjectAgent, projectPath, {
          prompt: 'Use your code interpreter to compute 5 factorial. Reply with just the number.',
          expected: '120',
        });
      },
      900000
    );

    it.skipIf(!canRun)(
      'exports the harness by ARN into a new empty project',
      async () => {
        expect(harnessArn, 'Harness ARN should have been captured from deploy #2').toBeTruthy();

        outDir = join(tmpdir(), `agentcore-e2e-${tmpTag}-out-${randomUUID()}`);
        await mkdir(outDir, { recursive: true });

        // A project-only scaffold (no agent) to receive the exported runtime.
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
            v.outProjectAgent,
            ...v.exportArgs,
            '--json',
          ],
          outProjectPath
        );
        expect(result.exitCode, `--arn export failed: stderr=${result.stderr}, stdout=${result.stdout}`).toBe(0);
        expect((parseJsonOutput(result.stdout) as { success: boolean }).success).toBe(true);

        // Out-of-project export: all the harness's resources are external to this fresh project, so
        // each is wired as a connection (resolved by ARN from the fetched harness).
        const cfg = JSON.parse(await readFile(join(outProjectPath, 'agentcore', 'agentcore.json'), 'utf-8')) as {
          runtimes: { name: string; connections?: { to: { type: string } }[] }[];
        };
        const agent = cfg.runtimes.find(r => r.name === v.outProjectAgent);
        expect(agent, `Exported runtime "${v.outProjectAgent}" should be in agentcore.json`).toBeDefined();
        const types = (agent!.connections ?? []).map(c => c.to.type);
        expect(types, `Expected memory + gateway + codeInterpreter connections; got: ${types.join(', ')}`).toEqual(
          expect.arrayContaining(['codeInterpreter', 'gateway', 'memory'])
        );
      },
      180000
    );

    it.skipIf(!canRun)(
      'deploys the out-of-project exported agent and verifies all capabilities at runtime',
      async () => {
        await deploy(outProjectPath, 'Out-of-project deploy');
        await verifyExportedAgentCapabilities(v.outProjectAgent, outProjectPath, {
          prompt: 'Use your code interpreter to compute 7 factorial. Reply with just the number.',
          expected: '5040',
        });
      },
      900000
    );
  });
}

createExportHarnessSuite({
  name: 'export-harness-java',
  title: 'e2e: export fully-featured harness to Java — in-project + out-of-project',
  resourceTag: 'ExpJ',
  inProjectAgent: 'InProjJavaAgent',
  outProjectAgent: 'OutProjJavaAgent',
  exportArgs: ['--language', 'Java', '--framework', 'SpringAI'],
  gatewayProtocol: 'MCP',
  verifyInProjectExport: async ({ connectionTypes, agentDir, memoryName, gatewayName }) => {
    // The MCP gateway is recorded under deployed-state `mcp.gateways`, so the mapper wires it as a
    // same-project gateway (McpConfig + implicit URL env var), not as a connection. The managed code
    // interpreter is always a connection.
    expect(connectionTypes, `Expected only a codeInterpreter connection; got: ${connectionTypes.join(', ')}`).toEqual([
      'codeInterpreter',
    ]);
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
});

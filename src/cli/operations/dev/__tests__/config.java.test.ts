import type { AgentCoreProjectSpec, AgentEnvSpec, DirectoryPath, FilePath } from '../../../../schema';
import { getDevConfig } from '../config';
import { createDevServer } from '../server';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

function projectWith(runtime: Partial<AgentEnvSpec>): AgentCoreProjectSpec {
  return {
    name: 'TestProject',
    version: 1,
    managedBy: 'CDK' as const,
    runtimes: [
      {
        name: 'Agent',
        build: 'Container',
        entrypoint: 'main.py' as FilePath,
        codeLocation: 'app/Agent/' as DirectoryPath,
        protocol: 'HTTP',
        ...runtime,
      } as AgentEnvSpec,
    ],
    memories: [],
    knowledgeBases: [],
    credentials: [],
    evaluators: [],
    onlineEvalConfigs: [],
    agentCoreGateways: [],
    policyEngines: [],
    configBundles: [],
    abTests: [],
    harnesses: [],
    datasets: [],
    payments: [],
  };
}

describe('Java dev detection', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'java-dev-config-'));
    mkdirSync(join(root, 'app', 'Agent'), { recursive: true });
    writeFileSync(join(root, 'app', 'Agent', 'pom.xml'), '<project/>');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('detects a Container agent with pom.xml as Java despite the main.py placeholder', () => {
    const config = getDevConfig(root, projectWith({}), join(root, 'agentcore'))!;
    expect(config.isJava).toBe(true);
    expect(
      createDevServer(config, { port: 8080, callbacks: { onLog: () => undefined, onExit: () => undefined } })
        .constructor.name
    ).toBe('MvnDevServer');
  });

  it('keeps a CodeZip Python agent with an auxiliary pom.xml on the CodeZip dev server', () => {
    const project = projectWith({ build: 'CodeZip', runtimeVersion: 'PYTHON_3_12' });
    const config = getDevConfig(root, project, join(root, 'agentcore'))!;
    expect(config).toMatchObject({ isPython: true, isJava: false, buildType: 'CodeZip' });
    expect(
      createDevServer(config, { port: 8080, callbacks: { onLog: () => undefined, onExit: () => undefined } })
        .constructor.name
    ).toBe('CodeZipDevServer');
  });
});

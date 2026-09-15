import { prereqs, runSuccess } from '../src/test-utils/index.js';
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Builds and runs a generated Java agent with no AWS access: Bedrock points at a closed local port,
// so these tests check the agent's own behaviour, not the model.
const HEADER = 'X-Amzn-Bedrock-AgentCore-Runtime';
const SYSTEM_PROMPT = ' Price $5 ${name} \\ tab\tend café 🌍';

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port'))
      );
    });
  });
}

async function waitForStart(proc: ChildProcess, timeoutMs: number): Promise<void> {
  let output = '';
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`agent did not start:\n${output}`)), timeoutMs);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('Started AgentApplication')) {
        clearTimeout(timer);
        resolve();
      }
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.on('exit', code => {
      clearTimeout(timer);
      reject(new Error(`agent exited with ${code}:\n${output}`));
    });
  });
}

describe.skipIf(!prereqs.npm || !prereqs.git || !prereqs.java)('integration: generated Java agent at runtime', () => {
  let testDir: string;
  let agentDir: string;
  let agent: ChildProcess | undefined;
  let port: number;

  async function invoke(userId: string): Promise<string> {
    const res = await fetch(`http://localhost:${port}/invocations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        [`${HEADER}-User-Id`]: userId,
        [`${HEADER}-Session-Id`]: 'session-1',
      },
      body: JSON.stringify({ prompt: 'Hello' }),
    });
    return res.text();
  }

  beforeAll(async () => {
    testDir = join(tmpdir(), `agentcore-integ-java-runtime-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
    const created = await runSuccess(['create', '--name', 'JavaRt', '--no-agent', '--skip-git', '--json'], testDir);
    const projectPath = created.projectPath as string;
    await runSuccess(
      ['add', 'gateway', '--name', 'tools-gw', '--protocol-type', 'MCP', '--authorizer-type', 'AWS_IAM', '--json'],
      projectPath
    );
    await runSuccess(
      ['add', 'agent', '--name', 'RtAgent', '--language', 'Java', '--system-prompt', SYSTEM_PROMPT, '--json'],
      projectPath
    );
    agentDir = join(projectPath, 'app', 'RtAgent');
    execFileSync('mvn', ['-q', '-B', '-DskipTests', 'package'], { cwd: agentDir, stdio: 'pipe' });

    port = await freePort();
    agent = spawn('java', ['-jar', 'target/RtAgent-0.0.1-SNAPSHOT.jar', `--server.port=${port}`], {
      cwd: agentDir,
      env: {
        ...process.env,
        AWS_REGION: 'us-east-1',
        AWS_ACCESS_KEY_ID: 'test',
        AWS_SECRET_ACCESS_KEY: 'test',
        AWS_ENDPOINT_URL_BEDROCK_RUNTIME: 'http://127.0.0.1:9',
      },
    });
    await waitForStart(agent, 60_000);
  }, 600_000);

  afterAll(async () => {
    agent?.kill();
    await rm(testDir, { recursive: true, force: true });
  });

  it('reads the system prompt back exactly through Spring Boot', async () => {
    const classpathFile = join(testDir, 'classpath.txt');
    execFileSync('mvn', ['-q', '-B', 'dependency:build-classpath', `-Dmdep.outputFile=${classpathFile}`], {
      cwd: agentDir,
      stdio: 'pipe',
    });
    const check = join(testDir, 'ReadPrompt.java');
    await writeFile(
      check,
      `import org.springframework.boot.env.PropertiesPropertySourceLoader;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.core.io.FileSystemResource;

public class ReadPrompt {
    public static void main(String[] args) throws Exception {
        var env = new StandardEnvironment();
        for (var source : new PropertiesPropertySourceLoader().load("app", new FileSystemResource(args[0]))) {
            env.getPropertySources().addFirst(source);
        }
        System.out.print(env.getProperty("agent.system-prompt"));
    }
}
`
    );
    const classpath = (await readFile(classpathFile, 'utf-8')).trim();
    const prompt = execFileSync(
      'java',
      ['-cp', classpath, check, join(agentDir, 'src/main/resources/application.properties')],
      { encoding: 'utf-8' }
    );
    expect(prompt).toBe(SYSTEM_PROMPT);
  });

  it('rejects a runtime user id that contains a colon', async () => {
    expect(await invoke('team:alice')).toContain(`{"error":"The runtime user id must not contain ':'."}`);
  });

  it('streams a fixed error message and keeps the cause out of the response', async () => {
    const body = await invoke('alice');
    expect(body).toContain('{"error":"The agent could not complete the request. See the agent logs for details."}');
    expect(body).not.toMatch(/127\.0\.0\.1|Exception|refused/i);
  });
});

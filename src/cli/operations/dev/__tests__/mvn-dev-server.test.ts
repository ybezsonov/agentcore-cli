import type { DevConfig } from '../config.js';
import type { DevServerOptions, SpawnConfig } from '../dev-server.js';
import { MvnDevServer } from '../mvn-dev-server.js';
import { createDevServer } from '../server.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const platformState = vi.hoisted(() => ({ isWindows: false }));
vi.mock('../../../../lib/utils/platform', async importActual => ({
  ...(await importActual<typeof import('../../../../lib/utils/platform')>()),
  getShellCommand: () => 'cmd',
  getShellArgs: (command: string) => ['/c', command],
  get isWindows() {
    return platformState.isWindows;
  },
}));

const config: DevConfig = {
  agentName: 'JavaAgent',
  module: 'main.py',
  directory: '/project/app/JavaAgent',
  hasConfig: true,
  isPython: true,
  isJava: true,
  buildType: 'Container',
  protocol: 'HTTP',
};

const options: DevServerOptions = {
  port: 8081,
  envVars: { AWS_REGION: 'us-west-2', CUSTOM: 'value' },
  callbacks: { onLog: vi.fn(), onExit: vi.fn() },
};

class ExposedMvnDevServer extends MvnDevServer {
  spawnConfig(): SpawnConfig {
    return this.getSpawnConfig();
  }
}

describe('MvnDevServer', () => {
  afterEach(() => {
    platformState.isWindows = false;
  });

  it('starts mvn.cmd through cmd on Windows', () => {
    platformState.isWindows = true;
    const spawn = new ExposedMvnDevServer(config, options).spawnConfig();
    expect(spawn).toMatchObject({ cmd: 'cmd', args: ['/c', 'mvn spring-boot:run'] });
  });

  it('runs spring-boot with local ports and caller environment', () => {
    const spawn = new ExposedMvnDevServer(config, options).spawnConfig();
    expect(spawn).toMatchObject({
      cmd: 'mvn',
      args: ['spring-boot:run'],
      cwd: '/project/app/JavaAgent',
    });
    expect(spawn.env).toMatchObject({
      AWS_REGION: 'us-west-2',
      CUSTOM: 'value',
      SERVER_PORT: '8081',
      PORT: '8081',
      LOCAL_DEV: '1',
    });
  });

  it('routes Java containers to Maven before the container branch', () => {
    expect(createDevServer(config, options)).toBeInstanceOf(MvnDevServer);
  });
});

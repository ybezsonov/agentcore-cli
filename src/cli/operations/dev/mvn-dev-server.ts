import { getShellArgs, getShellCommand, isWindows } from '../../../lib/utils/platform';
import { DevServer, type SpawnConfig } from './dev-server';
import { waitForServerReady } from './utils';
import { type ChildProcess, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Readiness includes a (possibly cold) Maven dependency download + compile before the
 * embedded server binds, so allow longer than the container port poll (which runs after
 * the image is already built).
 */
const MVN_READY_TIMEOUT_MS = 180_000;

/**
 * Dev server for Java/Spring AI agents. Runs the agent natively via `mvn spring-boot:run`
 * (or the project's `./mvnw` wrapper when present) instead of rebuilding the container image
 * on every change, giving a fast local iteration loop that matches the Python/TypeScript dev
 * experience. Java agents remain container-only for deploy; this is a dev-only run mode.
 */
export class MvnDevServer extends DevServer {
  /** Prefer the project's Maven wrapper if it ships one; otherwise require `mvn` on PATH. */
  private resolveMavenCommand(): { cmd: string; usesWrapper: boolean } {
    const wrapper = isWindows ? 'mvnw.cmd' : 'mvnw';
    if (existsSync(join(this.config.directory, wrapper))) {
      return { cmd: isWindows ? wrapper : './mvnw', usesWrapper: true };
    }
    return { cmd: 'mvn', usesWrapper: false };
  }

  // Setup is synchronous (a Maven availability check), but the base class contract is async.
  protected prepare(): Promise<boolean> {
    const { onLog } = this.options.callbacks;
    const { cmd, usesWrapper } = this.resolveMavenCommand();

    // The wrapper is self-contained; a bare `mvn` must be installed on PATH.
    if (!usesWrapper) {
      const check = spawnSync('mvn', ['-v'], { cwd: this.config.directory, stdio: 'ignore' });
      if (check.error || check.status !== 0) {
        onLog(
          'error',
          'Maven not found. Install Maven (`mvn`) or add a Maven wrapper (`mvnw`) to the project to run Java agents locally.'
        );
        return Promise.resolve(false);
      }
    }

    onLog('system', `Starting Spring Boot via \`${cmd} spring-boot:run\` (first run may download dependencies)...`);
    return Promise.resolve(true);
  }

  protected getSpawnConfig(): SpawnConfig {
    const { port, envVars = {} } = this.options;
    const { cmd } = this.resolveMavenCommand();

    // Spring Boot relaxed binding: SERVER_PORT -> server.port. Environment variables outrank
    // application.properties, so the dev port is honored regardless of the baked-in server.port.
    // PORT is set too for templates that read it directly.
    const env: Record<string, string | undefined> = {
      ...process.env,
      ...envVars,
      SERVER_PORT: String(port),
      PORT: String(port),
      LOCAL_DEV: '1',
    };

    const runArgs = ['spring-boot:run'];
    if (isWindows) {
      return {
        cmd: getShellCommand(),
        args: getShellArgs(`${cmd} ${runArgs.join(' ')}`),
        cwd: this.config.directory,
        env,
      };
    }
    return { cmd, args: runArgs, cwd: this.config.directory, env };
  }

  /**
   * Spring Boot logs a readiness banner but on a different line format than the TUI's Python/Node
   * detection; poll the port instead (as ContainerDevServer does) and inject the exact marker
   * useDevServer looks for once the embedded server is accepting connections.
   */
  override async start(): Promise<ChildProcess | null> {
    const child = await super.start();
    if (child) {
      const { onLog } = this.options.callbacks;
      onLog('system', 'Waiting for Spring Boot to start...');
      const ready = await waitForServerReady(this.options.port, MVN_READY_TIMEOUT_MS);
      if (ready) {
        onLog('info', 'Application startup complete');
      } else {
        onLog('error', `Spring Boot did not become ready within ${MVN_READY_TIMEOUT_MS / 1000} seconds.`);
      }
    }
    return child;
  }
}

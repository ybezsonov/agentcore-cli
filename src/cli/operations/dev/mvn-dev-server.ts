import { getShellArgs, getShellCommand, isWindows } from '../../../lib/utils/platform';
import { checkBinaryAvailable } from '../../external-requirements';
import { DevServer, type SpawnConfig } from './dev-server';

/** Native Maven dev server for Java agents. Restarts on demand; it does not provide hot reload. */
export class MvnDevServer extends DevServer {
  protected async prepare(): Promise<boolean> {
    if (await checkBinaryAvailable('mvn')) return true;
    this.options.callbacks.onLog(
      'error',
      'Maven not found. Install Maven 3.9+ from https://maven.apache.org/install.html'
    );
    return false;
  }

  protected getSpawnConfig(): SpawnConfig {
    const port = String(this.options.port);
    // On Windows Maven is the `mvn.cmd` script, which spawn() can start only through a shell.
    return {
      cmd: isWindows ? getShellCommand() : 'mvn',
      args: isWindows ? getShellArgs('mvn spring-boot:run') : ['spring-boot:run'],
      cwd: this.config.directory,
      env: {
        ...process.env,
        ...this.options.envVars,
        SERVER_PORT: port,
        PORT: port,
        LOCAL_DEV: '1',
      },
    };
  }
}

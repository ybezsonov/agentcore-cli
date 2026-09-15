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
    return {
      cmd: 'mvn',
      args: ['spring-boot:run'],
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

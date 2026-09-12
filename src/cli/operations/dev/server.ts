import { CodeZipDevServer } from './codezip-dev-server';
import type { DevConfig } from './config';
import { ContainerDevServer } from './container-dev-server';
import type { DevServer, DevServerOptions } from './dev-server';
import { MvnDevServer } from './mvn-dev-server';

/**
 * Dev server barrel module.
 * Re-exports types, utilities, and the factory function.
 */
export { findAvailablePort, waitForPort, waitForServerReady } from './utils';
export { DevServer, type LogLevel, type DevServerCallbacks, type DevServerOptions } from './dev-server';
export { CodeZipDevServer } from './codezip-dev-server';
export { ContainerDevServer } from './container-dev-server';
export { MvnDevServer } from './mvn-dev-server';

/**
 * Factory function to create the appropriate dev server.
 *
 * Java/Spring agents are container-only for deploy, but locally run natively via
 * `mvn spring-boot:run` (a fast iteration loop), so they route to MvnDevServer ahead of the
 * container/CodeZip build-type split.
 */
export function createDevServer(config: DevConfig, options: DevServerOptions): DevServer {
  if (config.isJava) {
    return new MvnDevServer(config, options);
  }
  return config.buildType === 'Container'
    ? new ContainerDevServer(config, options)
    : new CodeZipDevServer(config, options);
}

import { gtmContainerIdSchema } from './schemas.js';

export interface ContainerConfig {
  /** GTM server container ID, e.g. GTM-ABC1234. */
  id: string;
  env: string;
  auth: string;
}

export class InvalidContainerConfigError extends Error {}

/**
 * Parses the Container Config string that GTM shows when a server container is set up manually. It is a base64
 * encoded query string such as `id=GTM-ABC1234&env=1&auth=...`, passed unchanged to the tagging server as
 * CONTAINER_CONFIG.
 */
export function parseContainerConfig(value: string): ContainerConfig {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) {
    throw new InvalidContainerConfigError('Container Config is not a base64 string.');
  }
  const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
  const params = new URLSearchParams(decoded);
  const id = params.get('id');
  const env = params.get('env');
  const auth = params.get('auth');
  if (!id || !env || !auth) {
    throw new InvalidContainerConfigError('Container Config must contain id, env and auth.');
  }
  if (!gtmContainerIdSchema.safeParse(id).success) {
    throw new InvalidContainerConfigError(`Container Config has an invalid container id: ${id}`);
  }
  return { id, env, auth };
}

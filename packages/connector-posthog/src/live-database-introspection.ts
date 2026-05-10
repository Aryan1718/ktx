import type { LiveDatabaseIntrospectionPort } from '@klo/context/ingest';
import type { KloProjectConnectionConfig } from '@klo/context/project';
import { KloPostHogScanConnector, type KloPostHogConnectionConfig, type KloPostHogFetch } from './connector.js';

interface CreatePostHogLiveDatabaseIntrospectionOptions {
  connections: Record<string, KloProjectConnectionConfig>;
  env?: NodeJS.ProcessEnv;
  fetch?: KloPostHogFetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

export function createPostHogLiveDatabaseIntrospection(
  options: CreatePostHogLiveDatabaseIntrospectionOptions,
): LiveDatabaseIntrospectionPort {
  return {
    async extractSchema(connectionId: string) {
      const connection = options.connections[connectionId] as KloPostHogConnectionConfig | undefined;
      const connector = new KloPostHogScanConnector({
        connectionId,
        connection,
        env: options.env,
        fetch: options.fetch,
        sleep: options.sleep,
        now: options.now,
      });
      try {
        return await connector.introspect({ connectionId, driver: 'posthog' }, { runId: `posthog-${connectionId}` });
      } finally {
        await connector.cleanup();
      }
    },
  };
}

import type { LiveDatabaseIntrospectionPort } from '@klo/context/ingest';
import type { KloProjectConnectionConfig } from '@klo/context/project';
import {
  KloPostgresScanConnector,
  type KloPostgresConnectionConfig,
  type KloPostgresEndpointResolver,
  type KloPostgresPoolFactory,
} from './connector.js';

interface CreatePostgresLiveDatabaseIntrospectionOptions {
  connections: Record<string, KloProjectConnectionConfig>;
  poolFactory?: KloPostgresPoolFactory;
  endpointResolver?: KloPostgresEndpointResolver;
  now?: () => Date;
}

export function createPostgresLiveDatabaseIntrospection(
  options: CreatePostgresLiveDatabaseIntrospectionOptions,
): LiveDatabaseIntrospectionPort {
  return {
    async extractSchema(connectionId: string) {
      const connection = options.connections[connectionId] as KloPostgresConnectionConfig | undefined;
      const connector = new KloPostgresScanConnector({
        connectionId,
        connection,
        poolFactory: options.poolFactory,
        endpointResolver: options.endpointResolver,
        now: options.now,
      });
      try {
        return await connector.introspect({ connectionId, driver: 'postgres' }, { runId: `postgres-${connectionId}` });
      } finally {
        await connector.cleanup();
      }
    },
  };
}

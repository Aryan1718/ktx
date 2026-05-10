import type { LiveDatabaseIntrospectionPort } from '@klo/context/ingest';
import type { KloProjectConnectionConfig } from '@klo/context/project';
import {
  KloMysqlScanConnector,
  type KloMysqlConnectionConfig,
  type KloMysqlEndpointResolver,
  type KloMysqlPoolFactory,
} from './connector.js';

interface CreateMysqlLiveDatabaseIntrospectionOptions {
  connections: Record<string, KloProjectConnectionConfig>;
  poolFactory?: KloMysqlPoolFactory;
  endpointResolver?: KloMysqlEndpointResolver;
  now?: () => Date;
}

export function createMysqlLiveDatabaseIntrospection(
  options: CreateMysqlLiveDatabaseIntrospectionOptions,
): LiveDatabaseIntrospectionPort {
  return {
    async extractSchema(connectionId: string) {
      const connection = options.connections[connectionId] as KloMysqlConnectionConfig | undefined;
      const connector = new KloMysqlScanConnector({
        connectionId,
        connection,
        poolFactory: options.poolFactory,
        endpointResolver: options.endpointResolver,
        now: options.now,
      });
      try {
        return await connector.introspect({ connectionId, driver: 'mysql' }, { runId: `mysql-${connectionId}` });
      } finally {
        await connector.cleanup();
      }
    },
  };
}

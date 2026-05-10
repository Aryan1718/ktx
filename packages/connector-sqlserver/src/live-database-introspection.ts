import type { LiveDatabaseIntrospectionPort } from '@klo/context/ingest';
import type { KloProjectConnectionConfig } from '@klo/context/project';
import {
  KloSqlServerScanConnector,
  type KloSqlServerConnectionConfig,
  type KloSqlServerEndpointResolver,
  type KloSqlServerPoolFactory,
} from './connector.js';

interface CreateSqlServerLiveDatabaseIntrospectionOptions {
  connections: Record<string, KloProjectConnectionConfig>;
  poolFactory?: KloSqlServerPoolFactory;
  endpointResolver?: KloSqlServerEndpointResolver;
  now?: () => Date;
}

export function createSqlServerLiveDatabaseIntrospection(
  options: CreateSqlServerLiveDatabaseIntrospectionOptions,
): LiveDatabaseIntrospectionPort {
  return {
    async extractSchema(connectionId: string) {
      const connection = options.connections[connectionId] as KloSqlServerConnectionConfig | undefined;
      const connector = new KloSqlServerScanConnector({
        connectionId,
        connection,
        poolFactory: options.poolFactory,
        endpointResolver: options.endpointResolver,
        now: options.now,
      });
      try {
        return await connector.introspect(
          { connectionId, driver: 'sqlserver' },
          { runId: `sqlserver-${connectionId}` },
        );
      } finally {
        await connector.cleanup();
      }
    },
  };
}

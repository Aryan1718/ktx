import type { LiveDatabaseIntrospectionPort } from '@klo/context/ingest';
import type { KloProjectConnectionConfig } from '@klo/context/project';
import {
  KloClickHouseScanConnector,
  type KloClickHouseClientFactory,
  type KloClickHouseConnectionConfig,
  type KloClickHouseEndpointResolver,
} from './connector.js';

interface CreateClickHouseLiveDatabaseIntrospectionOptions {
  connections: Record<string, KloProjectConnectionConfig>;
  clientFactory?: KloClickHouseClientFactory;
  endpointResolver?: KloClickHouseEndpointResolver;
  now?: () => Date;
}

export function createClickHouseLiveDatabaseIntrospection(
  options: CreateClickHouseLiveDatabaseIntrospectionOptions,
): LiveDatabaseIntrospectionPort {
  return {
    async extractSchema(connectionId: string) {
      const connection = options.connections[connectionId] as KloClickHouseConnectionConfig | undefined;
      const connector = new KloClickHouseScanConnector({
        connectionId,
        connection,
        clientFactory: options.clientFactory,
        endpointResolver: options.endpointResolver,
        now: options.now,
      });
      try {
        return await connector.introspect(
          { connectionId, driver: 'clickhouse' },
          { runId: `clickhouse-${connectionId}` },
        );
      } finally {
        await connector.cleanup();
      }
    },
  };
}

import type { LiveDatabaseIntrospectionPort } from '@klo/context/ingest';
import type { KloProjectConnectionConfig } from '@klo/context/project';
import {
  KloBigQueryScanConnector,
  type KloBigQueryClientFactory,
  type KloBigQueryConnectionConfig,
} from './connector.js';

interface CreateBigQueryLiveDatabaseIntrospectionOptions {
  connections: Record<string, KloProjectConnectionConfig>;
  clientFactory?: KloBigQueryClientFactory;
  now?: () => Date;
}

export function createBigQueryLiveDatabaseIntrospection(
  options: CreateBigQueryLiveDatabaseIntrospectionOptions,
): LiveDatabaseIntrospectionPort {
  return {
    async extractSchema(connectionId: string) {
      const connection = options.connections[connectionId] as KloBigQueryConnectionConfig | undefined;
      const connector = new KloBigQueryScanConnector({
        connectionId,
        connection,
        clientFactory: options.clientFactory,
        now: options.now,
      });
      try {
        return await connector.introspect({ connectionId, driver: 'bigquery' }, { runId: `bigquery-${connectionId}` });
      } finally {
        await connector.cleanup();
      }
    },
  };
}

import type { LiveDatabaseIntrospectionPort } from '@klo/context/ingest';
import type { KloProjectConnectionConfig } from '@klo/context/project';
import { KloSqliteScanConnector, type KloSqliteConnectionConfig } from './connector.js';

export interface CreateSqliteLiveDatabaseIntrospectionOptions {
  projectDir?: string;
  connections: Record<string, KloProjectConnectionConfig>;
  now?: () => Date;
}

export function createSqliteLiveDatabaseIntrospection(
  options: CreateSqliteLiveDatabaseIntrospectionOptions,
): LiveDatabaseIntrospectionPort {
  return {
    async extractSchema(connectionId: string) {
      const connection = options.connections[connectionId] as KloSqliteConnectionConfig | undefined;
      const connector = new KloSqliteScanConnector({
        connectionId,
        connection,
        projectDir: options.projectDir,
        now: options.now,
      });
      try {
        return await connector.introspect({ connectionId, driver: 'sqlite' }, { runId: `sqlite-${connectionId}` });
      } finally {
        await connector.cleanup();
      }
    },
  };
}

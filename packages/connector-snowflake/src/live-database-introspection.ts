import type { LiveDatabaseIntrospectionPort } from '@klo/context/ingest';
import type { KloProjectConnectionConfig } from '@klo/context/project';
import {
  KloSnowflakeScanConnector,
  type KloSnowflakeConnectionConfig,
  type KloSnowflakeDriverFactory,
  type KloSnowflakeSdkOptionsProvider,
} from './connector.js';

interface CreateSnowflakeLiveDatabaseIntrospectionOptions {
  connections: Record<string, KloProjectConnectionConfig>;
  driverFactory?: KloSnowflakeDriverFactory;
  sdkOptionsProvider?: KloSnowflakeSdkOptionsProvider;
  now?: () => Date;
}

export function createSnowflakeLiveDatabaseIntrospection(
  options: CreateSnowflakeLiveDatabaseIntrospectionOptions,
): LiveDatabaseIntrospectionPort {
  return {
    async extractSchema(connectionId: string) {
      const connection = options.connections[connectionId] as KloSnowflakeConnectionConfig | undefined;
      const connector = new KloSnowflakeScanConnector({
        connectionId,
        connection,
        driverFactory: options.driverFactory,
        sdkOptionsProvider: options.sdkOptionsProvider,
        now: options.now,
      });
      try {
        return await connector.introspect(
          { connectionId, driver: 'snowflake' },
          { runId: `snowflake-${connectionId}` },
        );
      } finally {
        await connector.cleanup();
      }
    },
  };
}

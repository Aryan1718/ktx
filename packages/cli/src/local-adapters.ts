import { join } from 'node:path';
import { createBigQueryLiveDatabaseIntrospection, isKloBigQueryConnectionConfig } from '@klo/connector-bigquery';
import { createClickHouseLiveDatabaseIntrospection, isKloClickHouseConnectionConfig } from '@klo/connector-clickhouse';
import { createMysqlLiveDatabaseIntrospection, isKloMysqlConnectionConfig } from '@klo/connector-mysql';
import {
  createPostgresLiveDatabaseIntrospection,
  isKloPostgresConnectionConfig,
  type KloPostgresConnectionConfig,
  KloPostgresHistoricSqlQueryClient,
} from '@klo/connector-postgres';
import { createSqliteLiveDatabaseIntrospection, isKloSqliteConnectionConfig } from '@klo/connector-sqlite';
import { createSqlServerLiveDatabaseIntrospection, isKloSqlServerConnectionConfig } from '@klo/connector-sqlserver';
import {
  createDaemonLiveDatabaseIntrospection,
  createDefaultLocalIngestAdapters,
  type DefaultLocalIngestAdaptersOptions,
  type LiveDatabaseIntrospectionPort,
  LiveDatabaseSourceAdapter,
  type SourceAdapter,
} from '@klo/context/ingest';
import type { KloLocalProject } from '@klo/context/project';
import { createHttpSqlAnalysisPort } from '@klo/context/sql-analysis';

function hasSnowflakeDriver(connection: unknown): boolean {
  return (
    typeof connection === 'object' &&
    connection !== null &&
    String((connection as { driver?: unknown }).driver ?? '').toLowerCase() === 'snowflake'
  );
}

function createKloCliLiveDatabaseIntrospection(
  project: KloLocalProject,
  options: DefaultLocalIngestAdaptersOptions = {},
): LiveDatabaseIntrospectionPort {
  const daemon = createDaemonLiveDatabaseIntrospection({
    connections: project.config.connections,
    ...options.databaseIntrospection,
    ...(options.databaseIntrospectionUrl ? { baseUrl: options.databaseIntrospectionUrl } : {}),
  });
  const sqlite = createSqliteLiveDatabaseIntrospection({
    projectDir: project.projectDir,
    connections: project.config.connections,
  });
  const mysql = createMysqlLiveDatabaseIntrospection({
    connections: project.config.connections,
  });
  const postgres = createPostgresLiveDatabaseIntrospection({
    connections: project.config.connections,
  });
  const clickhouse = createClickHouseLiveDatabaseIntrospection({
    connections: project.config.connections,
  });
  const sqlserver = createSqlServerLiveDatabaseIntrospection({
    connections: project.config.connections,
  });
  const bigquery = createBigQueryLiveDatabaseIntrospection({
    connections: project.config.connections,
  });
  return {
    async extractSchema(connectionId: string) {
      const connection = project.config.connections[connectionId];
      if (isKloPostgresConnectionConfig(connection)) {
        return postgres.extractSchema(connectionId);
      }
      if (isKloSqliteConnectionConfig(connection)) {
        return sqlite.extractSchema(connectionId);
      }
      if (isKloMysqlConnectionConfig(connection)) {
        return mysql.extractSchema(connectionId);
      }
      if (isKloClickHouseConnectionConfig(connection)) {
        return clickhouse.extractSchema(connectionId);
      }
      if (isKloSqlServerConnectionConfig(connection)) {
        return sqlserver.extractSchema(connectionId);
      }
      if (isKloBigQueryConnectionConfig(connection)) {
        return bigquery.extractSchema(connectionId);
      }
      if (hasSnowflakeDriver(connection)) {
        const { createSnowflakeLiveDatabaseIntrospection, isKloSnowflakeConnectionConfig } = await import(
          '@klo/connector-snowflake'
        );
        if (!isKloSnowflakeConnectionConfig(connection)) {
          return daemon.extractSchema(connectionId);
        }
        const snowflake = createSnowflakeLiveDatabaseIntrospection({
          connections: project.config.connections,
        });
        return snowflake.extractSchema(connectionId);
      }
      return daemon.extractSchema(connectionId);
    },
  };
}

interface KloCliLocalIngestAdaptersOptions extends DefaultLocalIngestAdaptersOptions {
  historicSqlConnectionId?: string;
  sqlAnalysisUrl?: string;
}

function isEnabledPostgresHistoricSqlConnection(connection: KloPostgresConnectionConfig | undefined): boolean {
  if (!connection || !isKloPostgresConnectionConfig(connection)) {
    return false;
  }
  const historicSql =
    typeof connection.historicSql === 'object' &&
    connection.historicSql !== null &&
    !Array.isArray(connection.historicSql)
      ? (connection.historicSql as Record<string, unknown>)
      : null;
  return historicSql?.enabled === true && historicSql.dialect === 'postgres';
}

function createEphemeralPostgresHistoricSqlClient(project: KloLocalProject, connectionId: string) {
  const connection = project.config.connections[connectionId] as KloPostgresConnectionConfig | undefined;
  if (!isKloPostgresConnectionConfig(connection)) {
    throw new Error(
      `Historic SQL local ingest requires a Postgres connection, got ${String(connection?.driver ?? 'unknown')}`,
    );
  }
  return {
    async executeQuery(sql: string, params?: unknown[]) {
      const client = new KloPostgresHistoricSqlQueryClient({
        connectionId,
        connection,
      });
      try {
        return await client.executeQuery(sql, params);
      } finally {
        await client.cleanup();
      }
    },
  };
}

function historicSqlOptionsForLocalRun(project: KloLocalProject, options: KloCliLocalIngestAdaptersOptions) {
  const connectionId = options.historicSqlConnectionId;
  if (!connectionId) {
    return undefined;
  }
  const connection = project.config.connections[connectionId] as KloPostgresConnectionConfig | undefined;
  if (!isEnabledPostgresHistoricSqlConnection(connection)) {
    return undefined;
  }
  return {
    sqlAnalysis: createHttpSqlAnalysisPort({
      baseUrl:
        options.sqlAnalysisUrl ??
        process.env.KLO_SQL_ANALYSIS_URL ??
        process.env.KLO_DAEMON_URL ??
        'http://127.0.0.1:8765',
    }),
    postgresQueryClient: createEphemeralPostgresHistoricSqlClient(project, connectionId),
    postgresBaselineRootDir: join(project.projectDir, '.klo/cache/historic-sql'),
  };
}

export function createKloCliLocalIngestAdapters(
  project: KloLocalProject,
  options: KloCliLocalIngestAdaptersOptions = {},
): SourceAdapter[] {
  const historicSql = historicSqlOptionsForLocalRun(project, options);
  const base = createDefaultLocalIngestAdapters(project, {
    ...options,
    ...(historicSql ? { historicSql } : {}),
  });
  const liveDatabase = new LiveDatabaseSourceAdapter({
    introspection: createKloCliLiveDatabaseIntrospection(project, options),
  });
  return base.map((adapter) => (adapter.source === 'live-database' ? liveDatabase : adapter));
}

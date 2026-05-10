import type { KloLocalProject } from '@klo/context/project';
import type { KloScanConnector } from '@klo/context/scan';

const SUPPORTED_DRIVERS = 'sqlite, postgres, mysql, clickhouse, sqlserver, bigquery, snowflake';

function bigQueryMaxBytesBilled(
  connection: KloLocalProject['config']['connections'][string],
): number | string | undefined {
  const raw = connection.maxBytesBilled ?? connection.max_bytes_billed;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? raw : undefined;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

export async function createKloCliScanConnector(
  project: KloLocalProject,
  connectionId: string,
): Promise<KloScanConnector> {
  const connection = project.config.connections[connectionId];
  if (!connection) {
    throw new Error(`Connection "${connectionId}" is not configured in klo.yaml`);
  }
  const driver = String(connection.driver ?? '').toLowerCase();
  if (!driver) {
    throw new Error(
      `Connection "${connectionId}" has no \`driver\` field in klo.yaml. Supported drivers: ${SUPPORTED_DRIVERS}.`,
    );
  }
  if (driver === 'sqlite' || driver === 'sqlite3') {
    const { KloSqliteScanConnector, isKloSqliteConnectionConfig } = await import('@klo/connector-sqlite');
    if (isKloSqliteConnectionConfig(connection)) {
      return new KloSqliteScanConnector({ connectionId, connection, projectDir: project.projectDir });
    }
  }
  if (driver === 'postgres' || driver === 'postgresql') {
    const { KloPostgresScanConnector, isKloPostgresConnectionConfig } = await import('@klo/connector-postgres');
    if (isKloPostgresConnectionConfig(connection)) {
      return new KloPostgresScanConnector({ connectionId, connection });
    }
  }
  if (driver === 'mysql') {
    const { KloMysqlScanConnector, isKloMysqlConnectionConfig } = await import('@klo/connector-mysql');
    if (isKloMysqlConnectionConfig(connection)) {
      return new KloMysqlScanConnector({ connectionId, connection });
    }
  }
  if (driver === 'clickhouse') {
    const { KloClickHouseScanConnector, isKloClickHouseConnectionConfig } = await import('@klo/connector-clickhouse');
    if (isKloClickHouseConnectionConfig(connection)) {
      return new KloClickHouseScanConnector({ connectionId, connection });
    }
  }
  if (driver === 'sqlserver') {
    const { KloSqlServerScanConnector, isKloSqlServerConnectionConfig } = await import('@klo/connector-sqlserver');
    if (isKloSqlServerConnectionConfig(connection)) {
      return new KloSqlServerScanConnector({ connectionId, connection });
    }
  }
  if (driver === 'bigquery') {
    const { KloBigQueryScanConnector, isKloBigQueryConnectionConfig } = await import('@klo/connector-bigquery');
    if (isKloBigQueryConnectionConfig(connection)) {
      const maxBytesBilled = bigQueryMaxBytesBilled(connection);
      return new KloBigQueryScanConnector({
        connectionId,
        connection,
        ...(maxBytesBilled !== undefined ? { maxBytesBilled } : {}),
      });
    }
  }
  if (driver === 'snowflake') {
    const { KloSnowflakeScanConnector, isKloSnowflakeConnectionConfig } = await import('@klo/connector-snowflake');
    if (isKloSnowflakeConnectionConfig(connection)) {
      return new KloSnowflakeScanConnector({ connectionId, connection });
    }
  }
  throw new Error(
    `Connection "${connectionId}" uses driver "${driver}", which has no native standalone KLO scan connector. Supported drivers: ${SUPPORTED_DRIVERS}.`,
  );
}

import { describe, expect, it } from 'vitest';

describe('@klo/connector-postgres package exports', () => {
  it('exports the connector, dialect, and live-database adapter', async () => {
    const connector = await import('./index.js');
    expect(connector.KloPostgresDialect).toBeTypeOf('function');
    expect(connector.KloPostgresScanConnector).toBeTypeOf('function');
    expect(connector.KloPostgresHistoricSqlQueryClient).toBeTypeOf('function');
    expect(connector.createPostgresLiveDatabaseIntrospection).toBeTypeOf('function');
    expect(connector.isKloPostgresConnectionConfig).toBeTypeOf('function');
    expect(connector.postgresPoolConfigFromConfig).toBeTypeOf('function');
  });
});

import { describe, expect, it } from 'vitest';

describe('@klo/connector-sqlserver package exports', () => {
  it('exports public connector APIs during package bootstrap', async () => {
    const connector = await import('./index.js');

    expect(connector.KloSqlServerDialect).toBeTypeOf('function');
    expect(connector.KloSqlServerScanConnector).toBeTypeOf('function');
    expect(connector.createSqlServerLiveDatabaseIntrospection).toBeTypeOf('function');
    expect(connector.sqlServerConnectionPoolConfigFromConfig).toBeTypeOf('function');
  });
});

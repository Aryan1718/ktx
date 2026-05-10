import { describe, expect, it } from 'vitest';

describe('@klo/connector-mysql package exports', () => {
  it('exports the native MySQL scan surface', async () => {
    const connector = await import('./index.js');

    expect(connector.KloMysqlDialect).toBeTypeOf('function');
    expect(connector.KloMysqlScanConnector).toBeTypeOf('function');
    expect(connector.createMysqlLiveDatabaseIntrospection).toBeTypeOf('function');
    expect(connector.isKloMysqlConnectionConfig).toBeTypeOf('function');
    expect(connector.mysqlConnectionPoolConfigFromConfig).toBeTypeOf('function');
  });
});

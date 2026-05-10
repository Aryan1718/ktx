import { describe, expect, it } from 'vitest';

describe('@klo/connector-clickhouse package exports', () => {
  it('exports public connector APIs during package bootstrap', async () => {
    const connector = await import('./index.js');

    expect(connector.KloClickHouseDialect).toBeTypeOf('function');
    expect(connector.KloClickHouseScanConnector).toBeTypeOf('function');
    expect(connector.clickHouseClientConfigFromConfig).toBeTypeOf('function');
    expect(connector.createClickHouseLiveDatabaseIntrospection).toBeTypeOf('function');
  });
});

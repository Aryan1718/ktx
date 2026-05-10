import { describe, expect, it } from 'vitest';

describe('@klo/connector-sqlite package exports', () => {
  it('exports the native SQLite scan connector surface', async () => {
    const connector = await import('./index.js');

    expect(connector.KloSqliteDialect).toBeTypeOf('function');
    expect(connector.KloSqliteScanConnector).toBeTypeOf('function');
    expect(connector.createSqliteLiveDatabaseIntrospection).toBeTypeOf('function');
    expect(connector.isKloSqliteConnectionConfig).toBeTypeOf('function');
    expect(connector.sqliteDatabasePathFromConfig).toBeTypeOf('function');
  });
});

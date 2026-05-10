import { describe, expect, it } from 'vitest';
import * as connector from './index.js';

describe('@klo/connector-bigquery exports', () => {
  it('exports public connector, dialect, and introspection APIs', () => {
    expect(connector.KloBigQueryDialect).toBeTypeOf('function');
    expect(connector.KloBigQueryScanConnector).toBeTypeOf('function');
    expect(connector.bigQueryConnectionConfigFromConfig).toBeTypeOf('function');
    expect(connector.createBigQueryLiveDatabaseIntrospection).toBeTypeOf('function');
  });
});

import { describe, expect, it } from 'vitest';
import * as connector from './index.js';

describe('@klo/connector-snowflake package exports', () => {
  it('exports public connector, dialect, and introspection APIs', () => {
    expect(connector.KloSnowflakeDialect).toBeTypeOf('function');
    expect(connector.KloSnowflakeScanConnector).toBeTypeOf('function');
    expect(connector.snowflakeConnectionConfigFromConfig).toBeTypeOf('function');
    expect(connector.createSnowflakeLiveDatabaseIntrospection).toBeTypeOf('function');
  });
});

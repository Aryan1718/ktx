export { KloPostHogDialect, type KloPostHogSampleColumnInfo } from './dialect.js';
export {
  getKloPostHogColumnDescription,
  getKloPostHogPropertyDescription,
  getKloPostHogTableDescription,
} from './schema-descriptions.js';
export {
  isKloPostHogConnectionConfig,
  KloPostHogScanConnector,
  postHogConnectionConfigFromConfig,
  type KloPostHogColumnDistinctValuesOptions,
  type KloPostHogColumnDistinctValuesResult,
  type KloPostHogConnectionConfig,
  type KloPostHogFetch,
  type KloPostHogReadOnlyQueryInput,
  type KloPostHogResolvedConnectionConfig,
  type KloPostHogScanConnectorOptions,
} from './connector.js';
export { createPostHogLiveDatabaseIntrospection } from './live-database-introspection.js';

import { z } from 'zod';

export const connectionTypeSchema = z.enum([
  'POSTGRESQL',
  'SQLITE',
  'SQLSERVER',
  'BIGQUERY',
  'SNOWFLAKE',
  'CENTRALREACH',
  'EPIC',
  'CERNER',
  'ATHENA',
  'QUICKBOOKS',
  'WORKDAY',
  'REST',
  'S3',
  'SLACK',
  'METABASE',
  'LOOKER',
  'NOTION',
  'POSTHOG',
  'MYSQL',
  'CLICKHOUSE',
  'PLAIN',
  'BETTERSTACK',
]);

export type ConnectionType = z.infer<typeof connectionTypeSchema>;

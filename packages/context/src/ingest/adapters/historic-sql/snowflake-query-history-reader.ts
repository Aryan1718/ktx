import { HistoricSqlGrantsMissingError } from './errors.js';
import {
  aggregatedTemplateSchema,
  type AggregatedTemplate,
  type HistoricSqlQueryHistoryReader,
  type HistoricSqlRawQueryRow,
  type HistoricSqlTimeWindow,
  type HistoricSqlUnifiedPullConfig,
} from './types.js';

interface QueryResultLike {
  headers: string[];
  rows: unknown[][];
  totalRows: number;
  error?: string;
}

interface QueryClientLike {
  executeQuery(query: string): Promise<QueryResultLike>;
}

const PROBE_SQL = 'SELECT 1 FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY LIMIT 1';

const SNOWFLAKE_GRANTS_REMEDIATION =
  'GRANT IMPORTED PRIVILEGES ON DATABASE SNOWFLAKE TO ROLE <connection role>;';

function queryClient(client: unknown): QueryClientLike {
  if (
    client &&
    typeof client === 'object' &&
    'executeQuery' in client &&
    typeof (client as { executeQuery?: unknown }).executeQuery === 'function'
  ) {
    return client as QueryClientLike;
  }
  throw new Error('Historic SQL Snowflake reader requires a query client with executeQuery(query)');
}

function grantsError(cause: unknown): HistoricSqlGrantsMissingError {
  const message =
    cause instanceof Error
      ? cause.message
      : typeof cause === 'string'
        ? cause
        : 'Snowflake role cannot query SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY.';
  return new HistoricSqlGrantsMissingError({
    dialect: 'snowflake',
    message: `Missing Snowflake audit grants for historic-SQL ingest: ${message}`,
    remediation: SNOWFLAKE_GRANTS_REMEDIATION,
    cause,
  });
}

function timestampLiteral(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid Snowflake query-history timestamp: ${String(value)}`);
  }
  return `'${date.toISOString().replace(/'/g, "''")}'::TIMESTAMP_TZ`;
}

function queryHistorySql(window: HistoricSqlTimeWindow, cursor?: string | null): string {
  const start = timestampLiteral(cursor ?? window.start);
  const end = timestampLiteral(window.end);
  return `
SELECT
  QUERY_ID,
  QUERY_TEXT,
  USER_NAME,
  ROLE_NAME,
  WAREHOUSE_NAME,
  DATABASE_NAME,
  SCHEMA_NAME,
  START_TIME,
  END_TIME,
  TOTAL_ELAPSED_TIME,
  ROWS_PRODUCED,
  EXECUTION_STATUS,
  ERROR_CODE,
  ERROR_MESSAGE
FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY
WHERE START_TIME >= ${start}
  AND START_TIME < ${end}
  AND QUERY_TEXT IS NOT NULL
ORDER BY START_TIME ASC, QUERY_ID ASC`.trim();
}

function indexByHeader(headers: string[]): Map<string, number> {
  const out = new Map<string, number>();
  headers.forEach((header, index) => {
    out.set(header.toUpperCase(), index);
  });
  return out;
}

function value(row: unknown[], indexes: Map<string, number>, name: string): unknown {
  const index = indexes.get(name.toUpperCase());
  return index === undefined ? null : row[index];
}

function nullableString(raw: unknown): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const text = String(raw);
  return text.length > 0 ? text : null;
}

function requiredString(raw: unknown, field: string): string {
  const text = nullableString(raw);
  if (!text) {
    throw new Error(`Snowflake QUERY_HISTORY row is missing ${field}`);
  }
  return text;
}

function nullableNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }
  const number = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(number)) {
    return null;
  }
  return number;
}

function requiredNumber(raw: unknown, field: string): number {
  const number = nullableNumber(raw);
  if (number === null) {
    throw new Error(`Snowflake QUERY_HISTORY row has invalid ${field}: ${String(raw)}`);
  }
  return number;
}

function requiredInteger(raw: unknown, field: string): number {
  return Math.trunc(requiredNumber(raw, field));
}

function nullableInteger(raw: unknown): number | null {
  const number = nullableNumber(raw);
  return number === null ? null : Math.trunc(number);
}

function isoTimestamp(raw: unknown, field: string): string {
  if (raw instanceof Date) {
    return raw.toISOString();
  }
  const text = requiredString(raw, field);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Snowflake QUERY_HISTORY row has invalid ${field}: ${text}`);
  }
  return date.toISOString();
}

function nullableIsoTimestamp(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }
  return isoTimestamp(raw, 'END_TIME');
}

function executionSucceeded(status: string | null, errorCode: string | null, errorMessage: string | null): boolean {
  if (errorCode || errorMessage) {
    return false;
  }
  return status === null || status.toUpperCase().startsWith('SUCCESS');
}

function combinedErrorMessage(errorCode: string | null, errorMessage: string | null): string | null {
  if (errorCode && errorMessage) {
    return `${errorCode}: ${errorMessage}`;
  }
  return errorMessage ?? errorCode;
}

function mapRow(row: unknown[], indexes: Map<string, number>): HistoricSqlRawQueryRow {
  const errorCode = nullableString(value(row, indexes, 'ERROR_CODE'));
  const errorMessage = nullableString(value(row, indexes, 'ERROR_MESSAGE'));
  const rowsProduced = nullableInteger(value(row, indexes, 'ROWS_PRODUCED'));
  return {
    id: requiredString(value(row, indexes, 'QUERY_ID'), 'QUERY_ID'),
    sql: requiredString(value(row, indexes, 'QUERY_TEXT'), 'QUERY_TEXT'),
    user: nullableString(value(row, indexes, 'USER_NAME')),
    startedAt: isoTimestamp(value(row, indexes, 'START_TIME'), 'START_TIME'),
    endedAt: nullableIsoTimestamp(value(row, indexes, 'END_TIME')),
    runtimeMs: nullableNumber(value(row, indexes, 'TOTAL_ELAPSED_TIME')),
    rowsProduced,
    success: executionSucceeded(nullableString(value(row, indexes, 'EXECUTION_STATUS')), errorCode, errorMessage),
    errorMessage: combinedErrorMessage(errorCode, errorMessage),
  };
}

function parseTopUsers(raw: unknown): Array<{ user: string | null; executions: number }> {
  const text = nullableString(raw);
  if (!text) {
    return [];
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') {
        return [];
      }
      const user = nullableString((entry as { user?: unknown }).user);
      const executions = nullableInteger((entry as { executions?: unknown }).executions);
      return executions === null ? [] : [{ user, executions }];
    });
  } catch {
    return [];
  }
}

function mapAggregatedRow(row: unknown[], indexes: Map<string, number>): AggregatedTemplate {
  return aggregatedTemplateSchema.parse({
    templateId: requiredString(value(row, indexes, 'template_id'), 'template_id'),
    canonicalSql: requiredString(value(row, indexes, 'canonical_sql'), 'canonical_sql'),
    dialect: 'snowflake',
    stats: {
      executions: requiredInteger(value(row, indexes, 'executions'), 'executions'),
      distinctUsers: requiredInteger(value(row, indexes, 'distinct_users'), 'distinct_users'),
      firstSeen: isoTimestamp(value(row, indexes, 'first_seen'), 'first_seen'),
      lastSeen: isoTimestamp(value(row, indexes, 'last_seen'), 'last_seen'),
      p50RuntimeMs: nullableNumber(value(row, indexes, 'p50_ms')),
      p95RuntimeMs: nullableNumber(value(row, indexes, 'p95_ms')),
      errorRate: requiredNumber(value(row, indexes, 'error_rate'), 'error_rate'),
      rowsProduced: nullableInteger(value(row, indexes, 'rows_produced')),
    },
    topUsers: parseTopUsers(value(row, indexes, 'top_users')),
  });
}

export class SnowflakeHistoricSqlQueryHistoryReader implements HistoricSqlQueryHistoryReader {
  async probe(client: unknown): Promise<void> {
    let result: QueryResultLike;
    try {
      result = await queryClient(client).executeQuery(PROBE_SQL);
    } catch (error) {
      throw grantsError(error);
    }
    if (result.error) {
      throw grantsError(result.error);
    }
  }

  async *fetch(
    client: unknown,
    window: HistoricSqlTimeWindow,
    cursor?: string | null,
  ): AsyncIterable<HistoricSqlRawQueryRow> {
    const result = await queryClient(client).executeQuery(queryHistorySql(window, cursor));
    if (result.error) {
      throw grantsError(result.error);
    }
    const indexes = indexByHeader(result.headers);
    for (const row of result.rows) {
      yield mapRow(row, indexes);
    }
  }

  async *fetchAggregated(
    client: unknown,
    window: HistoricSqlTimeWindow,
    config: HistoricSqlUnifiedPullConfig,
  ): AsyncIterable<AggregatedTemplate> {
    const sql = `
SELECT
  query_hash AS template_id,
  MIN(query_text) AS canonical_sql,
  COUNT(*) AS executions,
  COUNT(DISTINCT user_name) AS distinct_users,
  MIN(start_time) AS first_seen,
  MAX(start_time) AS last_seen,
  APPROX_PERCENTILE(total_elapsed_time, 0.50) AS p50_ms,
  APPROX_PERCENTILE(total_elapsed_time, 0.95) AS p95_ms,
  DIV0(COUNT_IF(execution_status != 'SUCCESS'), COUNT(*)) AS error_rate,
  SUM(rows_produced) AS rows_produced,
  ARRAY_AGG(OBJECT_CONSTRUCT('user', user_name, 'executions', 1)) WITHIN GROUP (ORDER BY start_time DESC)::string AS top_users
FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY
WHERE query_text IS NOT NULL
  AND query_type IN ('SELECT', 'MERGE')
  AND start_time >= ${timestampLiteral(window.start)}
  AND start_time < ${timestampLiteral(window.end)}
GROUP BY query_hash
HAVING COUNT(*) >= ${config.minExecutions}
ORDER BY executions DESC`.trim();
    const result = await queryClient(client).executeQuery(sql);
    if (result.error) {
      throw grantsError(result.error);
    }
    const indexes = indexByHeader(result.headers);
    for (const row of result.rows) {
      yield mapAggregatedRow(row, indexes);
    }
  }
}

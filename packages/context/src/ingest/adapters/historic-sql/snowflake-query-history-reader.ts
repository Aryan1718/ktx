import { HistoricSqlGrantsMissingError } from './errors.js';
import type { HistoricSqlQueryHistoryReader, HistoricSqlRawQueryRow, HistoricSqlTimeWindow } from './types.js';

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
  const index = indexes.get(name);
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
}

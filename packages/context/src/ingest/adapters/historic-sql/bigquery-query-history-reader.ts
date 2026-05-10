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

export interface BigQueryHistoricSqlQueryHistoryReaderOptions {
  projectId: string;
  region: string;
}

const BIGQUERY_GRANTS_REMEDIATION =
  'Grant roles/bigquery.resourceViewer on the BigQuery project, or grant a custom role containing bigquery.jobs.listAll.';

function queryClient(client: unknown): QueryClientLike {
  if (
    client &&
    typeof client === 'object' &&
    'executeQuery' in client &&
    typeof (client as { executeQuery?: unknown }).executeQuery === 'function'
  ) {
    return client as QueryClientLike;
  }
  throw new Error('Historic SQL BigQuery reader requires a query client with executeQuery(query)');
}

function grantsError(cause: unknown): HistoricSqlGrantsMissingError {
  const message =
    cause instanceof Error
      ? cause.message
      : typeof cause === 'string'
        ? cause
        : 'BigQuery principal cannot query INFORMATION_SCHEMA.JOBS_BY_PROJECT.';
  return new HistoricSqlGrantsMissingError({
    dialect: 'bigquery',
    message: `Missing BigQuery audit grants for historic-SQL ingest: ${message}`,
    remediation: BIGQUERY_GRANTS_REMEDIATION,
    cause,
  });
}

function normalizeProjectId(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid BigQuery project id for historic-SQL ingest: ${value}`);
  }
  return value;
}

function normalizeRegion(value: string): string {
  const region = value.trim().toLowerCase().replace(/^region-/, '');
  if (!/^[a-z0-9-]+$/.test(region)) {
    throw new Error(`Invalid BigQuery region for historic-SQL ingest: ${value}`);
  }
  return region;
}

function timestampExpression(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid BigQuery query-history timestamp: ${String(value)}`);
  }
  return `TIMESTAMP('${date.toISOString().replace(/'/g, "\\'")}')`;
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
    throw new Error(`BigQuery JOBS_BY_PROJECT row is missing ${field}`);
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
  return Math.max(0, number);
}

function isoTimestamp(raw: unknown, field: string): string {
  if (raw instanceof Date) {
    return raw.toISOString();
  }
  const text = requiredString(raw, field);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`BigQuery JOBS_BY_PROJECT row has invalid ${field}: ${text}`);
  }
  return date.toISOString();
}

function nullableIsoTimestamp(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }
  return isoTimestamp(raw, 'end_time');
}

function executionSucceeded(state: string | null, errorReason: string | null, errorMessage: string | null): boolean {
  if (errorReason || errorMessage) {
    return false;
  }
  return state === null || state.toUpperCase() === 'DONE';
}

function combinedErrorMessage(errorReason: string | null, errorMessage: string | null): string | null {
  if (errorReason && errorMessage) {
    return `${errorReason}: ${errorMessage}`;
  }
  return errorMessage ?? errorReason;
}

function mapRow(row: unknown[], indexes: Map<string, number>): HistoricSqlRawQueryRow {
  const errorReason = nullableString(value(row, indexes, 'error_reason'));
  const errorMessage = nullableString(value(row, indexes, 'error_message'));
  return {
    id: requiredString(value(row, indexes, 'job_id'), 'job_id'),
    sql: requiredString(value(row, indexes, 'query'), 'query'),
    user: nullableString(value(row, indexes, 'user_email')),
    startedAt: isoTimestamp(value(row, indexes, 'creation_time'), 'creation_time'),
    endedAt: nullableIsoTimestamp(value(row, indexes, 'end_time')),
    runtimeMs: nullableNumber(value(row, indexes, 'runtime_ms')),
    success: executionSucceeded(nullableString(value(row, indexes, 'state')), errorReason, errorMessage),
    errorMessage: combinedErrorMessage(errorReason, errorMessage),
  };
}

export class BigQueryHistoricSqlQueryHistoryReader implements HistoricSqlQueryHistoryReader {
  private readonly viewPath: string;

  constructor(options: BigQueryHistoricSqlQueryHistoryReaderOptions) {
    const projectId = normalizeProjectId(options.projectId);
    const region = normalizeRegion(options.region);
    this.viewPath = `\`${projectId}.region-${region}.INFORMATION_SCHEMA.JOBS_BY_PROJECT\``;
  }

  async probe(client: unknown): Promise<void> {
    let result: QueryResultLike;
    try {
      result = await queryClient(client).executeQuery(`SELECT 1 FROM ${this.viewPath} LIMIT 1`);
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
    const start = timestampExpression(cursor ?? window.start);
    const end = timestampExpression(window.end);
    const sql = `
SELECT
  job_id,
  query,
  user_email,
  creation_time,
  end_time,
  TIMESTAMP_DIFF(end_time, creation_time, MILLISECOND) AS runtime_ms,
  total_slot_ms,
  total_bytes_processed,
  state,
  error_result.reason AS error_reason,
  error_result.message AS error_message,
  statement_type
FROM ${this.viewPath}
WHERE creation_time >= ${start}
  AND creation_time < ${end}
  AND job_type = 'QUERY'
  AND query IS NOT NULL
  AND (statement_type IS NULL OR statement_type != 'SCRIPT')
ORDER BY creation_time ASC, job_id ASC`.trim();
    const result = await queryClient(client).executeQuery(sql);
    if (result.error) {
      throw grantsError(result.error);
    }
    const indexes = indexByHeader(result.headers);
    for (const row of result.rows) {
      yield mapRow(row, indexes);
    }
  }
}

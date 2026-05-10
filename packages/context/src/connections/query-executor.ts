import type { KloProjectConnectionConfig } from '../project/index.js';

export interface KloSqlQueryExecutionInput {
  connectionId: string;
  projectDir?: string;
  connection: KloProjectConnectionConfig | undefined;
  sql: string;
  maxRows?: number;
}

export interface KloSqlQueryExecutionResult {
  headers: string[];
  rows: unknown[][];
  totalRows: number;
  command: string;
  rowCount: number | null;
}

export interface KloSqlQueryExecutorPort {
  execute(input: KloSqlQueryExecutionInput): Promise<KloSqlQueryExecutionResult>;
}

export function normalizeQueryRows(rows: unknown[]): unknown[][] {
  return rows.map((row) => (Array.isArray(row) ? row : Object.values(row as Record<string, unknown>)));
}

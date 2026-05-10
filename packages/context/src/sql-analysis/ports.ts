export type SqlAnalysisDialect =
  | 'bigquery'
  | 'snowflake'
  | 'postgres'
  | 'redshift'
  | 'mysql'
  | 'sqlite'
  | 'tsql'
  | 'clickhouse'
  | (string & {});

export type SqlAnalysisLiteralSlotType = 'string' | 'number' | 'timestamp' | 'date' | 'boolean' | 'null' | 'unknown';

export interface SqlAnalysisLiteralSlot {
  position: number;
  type: SqlAnalysisLiteralSlotType;
  exampleValue: string;
}

export interface SqlAnalysisFingerprintResult {
  fingerprint: string;
  normalizedSql: string;
  tablesTouched: string[];
  literalSlots: SqlAnalysisLiteralSlot[];
  error?: string | null;
}

export interface SqlAnalysisPort {
  analyzeForFingerprint(sql: string, dialect: SqlAnalysisDialect): Promise<SqlAnalysisFingerprintResult>;
}

import { createPostgresQueryExecutor } from './postgres-query-executor.js';
import type {
  KloSqlQueryExecutionInput,
  KloSqlQueryExecutionResult,
  KloSqlQueryExecutorPort,
} from './query-executor.js';
import { createSqliteQueryExecutor } from './sqlite-query-executor.js';

export interface DefaultLocalQueryExecutorOptions {
  postgres?: KloSqlQueryExecutorPort;
  sqlite?: KloSqlQueryExecutorPort;
}

function driverFor(input: KloSqlQueryExecutionInput): string {
  return String(input.connection?.driver ?? '').toLowerCase();
}

export function createDefaultLocalQueryExecutor(options: DefaultLocalQueryExecutorOptions = {}): KloSqlQueryExecutorPort {
  const postgres = options.postgres ?? createPostgresQueryExecutor();
  const sqlite = options.sqlite ?? createSqliteQueryExecutor();

  return {
    async execute(input: KloSqlQueryExecutionInput): Promise<KloSqlQueryExecutionResult> {
      const driver = driverFor(input);
      if (driver === 'postgres' || driver === 'postgresql') {
        return postgres.execute(input);
      }
      if (driver === 'sqlite' || driver === 'sqlite3') {
        return sqlite.execute(input);
      }
      throw new Error(`No local query executor is configured for driver "${input.connection?.driver ?? 'unknown'}".`);
    },
  };
}

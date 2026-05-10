import type { KloProjectConfig, KloProjectConnectionConfig } from '@klo/context/project';
import type { DoctorCheck } from './doctor.js';

export interface HistoricSqlDoctorProject {
  projectDir: string;
  config: Pick<KloProjectConfig, 'connections' | 'ingest'>;
}

export interface PostgresHistoricSqlDoctorProbeInput {
  projectDir: string;
  connectionId: string;
  connection: KloProjectConnectionConfig;
  env: NodeJS.ProcessEnv;
}

export interface PostgresHistoricSqlDoctorProbeResult {
  pgServerVersion: string;
  warnings: string[];
}

export type PostgresHistoricSqlDoctorProbe = (
  input: PostgresHistoricSqlDoctorProbeInput,
) => Promise<PostgresHistoricSqlDoctorProbeResult>;

export interface HistoricSqlDoctorDeps {
  env?: NodeJS.ProcessEnv;
  postgresHistoricSqlProbe?: PostgresHistoricSqlDoctorProbe;
}

function check(status: DoctorCheck['status'], id: string, label: string, detail: string, fix?: string): DoctorCheck {
  return fix ? { id, label, status, detail, fix } : { id, label, status, detail };
}

function historicSqlRecord(connection: KloProjectConnectionConfig): Record<string, unknown> | null {
  const historicSql = connection.historicSql;
  return historicSql && typeof historicSql === 'object' && !Array.isArray(historicSql)
    ? (historicSql as Record<string, unknown>)
    : null;
}

function isEnabledPostgresHistoricSql(connection: KloProjectConnectionConfig): boolean {
  const historicSql = historicSqlRecord(connection);
  return historicSql?.enabled === true && historicSql.dialect === 'postgres';
}

function isPostgresDriver(connection: KloProjectConnectionConfig): boolean {
  const driver = String(connection.driver ?? '').toLowerCase();
  return driver === 'postgres' || driver === 'postgresql';
}

function checkId(connectionId: string): string {
  return `historic-sql-postgres-${connectionId.replace(/[^a-z0-9_-]+/gi, '-')}`;
}

function capabilityFailureFix(error: unknown, connectionId: string, projectDir: string): string {
  if (error instanceof Error && error.name === 'HistoricSqlExtensionMissingError' && 'remediation' in error) {
    return String(error.remediation);
  }
  if (error instanceof Error && error.name === 'HistoricSqlGrantsMissingError' && 'remediation' in error) {
    return String(error.remediation);
  }
  if (error instanceof Error && error.name === 'HistoricSqlVersionUnsupportedError') {
    return 'Use PostgreSQL 14 or newer, or disable historicSql for this connection';
  }
  return `Fix connections.${connectionId} Postgres settings, then rerun \`klo dev doctor --project-dir ${projectDir}\``;
}

function failureDetail(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim().split('\n')[0] ?? error.message.trim();
  }
  return String(error);
}

async function defaultPostgresHistoricSqlProbe(
  input: PostgresHistoricSqlDoctorProbeInput,
): Promise<PostgresHistoricSqlDoctorProbeResult> {
  const [{ PostgresPgssQueryHistoryReader }, { KloPostgresHistoricSqlQueryClient, isKloPostgresConnectionConfig }] =
    await Promise.all([import('@klo/context/ingest'), import('@klo/connector-postgres')]);

  if (!isKloPostgresConnectionConfig(input.connection)) {
    throw new Error(`Native PostgreSQL connector cannot run driver "${input.connection.driver ?? 'unknown'}"`);
  }

  const client = new KloPostgresHistoricSqlQueryClient({
    connectionId: input.connectionId,
    connection: input.connection,
    env: input.env,
  });
  try {
    return await new PostgresPgssQueryHistoryReader().probe(client);
  } finally {
    await client.cleanup();
  }
}

export async function runPostgresHistoricSqlDoctorChecks(
  project: HistoricSqlDoctorProject,
  deps: HistoricSqlDoctorDeps = {},
): Promise<DoctorCheck[]> {
  const targets = Object.entries(project.config.connections)
    .filter(([, connection]) => isEnabledPostgresHistoricSql(connection))
    .sort(([left], [right]) => left.localeCompare(right));

  if (targets.length === 0) {
    return [
      check('pass', 'historic-sql-postgres', 'Postgres Historic SQL', 'No enabled Postgres historic-SQL connections'),
    ];
  }

  const probe = deps.postgresHistoricSqlProbe ?? defaultPostgresHistoricSqlProbe;
  const env = deps.env ?? process.env;
  const checks: DoctorCheck[] = [];
  for (const [connectionId, connection] of targets) {
    const label = `Postgres Historic SQL (${connectionId})`;
    if (!isPostgresDriver(connection)) {
      checks.push(
        check(
          'fail',
          checkId(connectionId),
          label,
          `connections.${connectionId}.historicSql.dialect is postgres but driver is ${String(connection.driver)}`,
          `Set connections.${connectionId}.driver to postgres or disable historicSql for this connection`,
        ),
      );
      continue;
    }

    try {
      const result = await probe({ projectDir: project.projectDir, connectionId, connection, env });
      if (result.warnings.length > 0) {
        checks.push(
          check(
            'warn',
            checkId(connectionId),
            label,
            `pg_stat_statements ready (${result.pgServerVersion}) with warnings: ${result.warnings.join('; ')}`,
            `Update the Postgres parameter group or config, then rerun \`klo dev doctor --project-dir ${project.projectDir}\``,
          ),
        );
      } else {
        checks.push(
          check('pass', checkId(connectionId), label, `pg_stat_statements ready (${result.pgServerVersion})`),
        );
      }
    } catch (error) {
      checks.push(
        check(
          'fail',
          checkId(connectionId),
          label,
          failureDetail(error),
          capabilityFailureFix(error, connectionId, project.projectDir),
        ),
      );
    }
  }

  return checks;
}

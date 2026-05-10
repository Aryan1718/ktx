import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  SqlAnalysisFingerprintResult,
  SqlAnalysisLiteralSlot,
  SqlAnalysisLiteralSlotType,
  SqlAnalysisPort,
} from '../../../sql-analysis/index.js';
import {
  HISTORIC_SQL_OBJECT_TYPE,
  HISTORIC_SQL_SOURCE_KEY,
  historicSqlPullConfigSchema,
  historicSqlRawQueryRowSchema,
  type HistoricSqlLiteralSlotClassification,
  type HistoricSqlManifest,
  type HistoricSqlMetadata,
  type HistoricSqlPullConfig,
  type HistoricSqlQueryHistoryReader,
  type HistoricSqlRawQueryRow,
  type HistoricSqlUsage,
} from './types.js';

interface StageHistoricSqlTemplatesInput {
  stagedDir: string;
  connectionId: string;
  queryClient: unknown;
  reader: HistoricSqlQueryHistoryReader;
  sqlAnalysis: SqlAnalysisPort;
  pullConfig: HistoricSqlPullConfig;
  now?: Date;
}

interface SlotObservation {
  value: string;
  rowStartedAt: string;
}

interface SlotStats {
  position: number;
  type: SqlAnalysisLiteralSlotType;
  values: Map<string, number>;
  observations: SlotObservation[];
}

interface TemplateAccumulator {
  fingerprint: string;
  normalizedSql: string;
  tablesTouched: Set<string>;
  rows: Array<{ row: HistoricSqlRawQueryRow; analysis: SqlAnalysisFingerprintResult }>;
  slotStats: Map<number, SlotStats>;
}

interface ClassifiedLiteralSlot {
  position: number;
  type: SqlAnalysisLiteralSlotType;
  classification: HistoricSqlLiteralSlotClassification;
}

interface TemplateVariant {
  id: string;
  fingerprint: string;
  subClusterId: string | null;
  normalizedSql: string;
  tablesTouched: Set<string>;
  rows: Array<{ row: HistoricSqlRawQueryRow; analysis: SqlAnalysisFingerprintResult }>;
  slotStats: Map<number, SlotStats>;
  slotClassifications: ClassifiedLiteralSlot[];
}

interface CategoricalTupleEntry {
  position: number;
  value: string;
}

interface RedactionPolicy {
  redactors: RegExp[];
  samplesAllowed: boolean;
}

const HARD_SKIP_PREFIX_RE = /^\s*(SHOW|DESCRIBE|DESC|EXPLAIN|USE|SET)\b/i;
const HARD_SKIP_TABLE_RE = /\b(INFORMATION_SCHEMA|SNOWFLAKE\.ACCOUNT_USAGE|pg_|system\.)/i;

export async function stageHistoricSqlTemplates(input: StageHistoricSqlTemplatesInput): Promise<void> {
  const config = historicSqlPullConfigSchema.parse(input.pullConfig);
  const now = input.now ?? new Date();
  const windowStart = config.lastSuccessfulCursor
    ? new Date(config.lastSuccessfulCursor)
    : new Date(now.getTime() - config.windowDays * 24 * 60 * 60 * 1000);
  const warnings: string[] = [];
  const redaction = compileRedactors(config.redactionPatterns, warnings);
  const groups = new Map<string, TemplateAccumulator>();
  let nextSuccessfulCursor: string | null = null;

  await input.reader.probe(input.queryClient);

  for await (const rawRow of input.reader.fetch(
    input.queryClient,
    { start: windowStart, end: now },
    config.lastSuccessfulCursor,
  )) {
    const row = historicSqlRawQueryRowSchema.parse(rawRow);
    if (!nextSuccessfulCursor || row.startedAt > nextSuccessfulCursor) {
      nextSuccessfulCursor = row.startedAt;
    }
    if (shouldSkipSql(row.sql)) {
      continue;
    }

    const analysis = await input.sqlAnalysis.analyzeForFingerprint(row.sql, config.dialect);
    if (analysis.error || !analysis.fingerprint || !analysis.normalizedSql) {
      warnings.push(`analysis_failed:${row.id}`);
      continue;
    }

    const group =
      groups.get(analysis.fingerprint) ??
      {
        fingerprint: analysis.fingerprint,
        normalizedSql: analysis.normalizedSql,
        tablesTouched: new Set<string>(),
        rows: [],
        slotStats: new Map<number, SlotStats>(),
      };

    for (const table of analysis.tablesTouched) {
      group.tablesTouched.add(table);
    }
    for (const slot of analysis.literalSlots) {
      recordSlot(group.slotStats, slot, redaction.redactors, row.startedAt);
    }
    group.rows.push({ row, analysis });
    groups.set(analysis.fingerprint, group);
  }

  const expandedTemplates = expandCategoricalTemplates([...groups.values()], redaction.redactors);
  const selected = selectTemplates(expandedTemplates, config.maxTemplatesPerRun, now);
  if (selected.length < expandedTemplates.length) {
    warnings.push(`templates_truncated: kept ${selected.length} of ${expandedTemplates.length} templates`);
  }

  await mkdir(input.stagedDir, { recursive: true });
  const templates: HistoricSqlManifest['templates'] = [];
  for (const template of selected) {
    const staged = buildStagedTemplate(template, config, redaction, now);
    const basePath = `templates/${staged.metadata.id}`;
    await writeJson(input.stagedDir, `${basePath}/metadata.json`, staged.metadata);
    await writeText(input.stagedDir, `${basePath}/page.md`, staged.pageMarkdown);
    await writeJson(input.stagedDir, `${basePath}/usage.json`, staged.usage);
    templates.push({
      id: staged.metadata.id,
      fingerprint: staged.metadata.properties.fingerprint,
      subClusterId: staged.metadata.properties.sub_cluster_id,
      path: staged.metadata.path,
    });
  }

  await writeJson(input.stagedDir, 'manifest.json', {
    source: HISTORIC_SQL_SOURCE_KEY,
    connectionId: input.connectionId,
    dialect: config.dialect,
    fetchedAt: now.toISOString(),
    windowStart: windowStart.toISOString(),
    windowEnd: now.toISOString(),
    nextSuccessfulCursor,
    templateCount: selected.length,
    capped: selected.length < expandedTemplates.length,
    warnings,
    degraded: false,
    statsResetAt: null,
    baselineFirstRun: false,
    pgServerVersion: null,
    deallocCount: null,
    templates,
  } satisfies HistoricSqlManifest);
}

function shouldSkipSql(sql: string): boolean {
  return HARD_SKIP_PREFIX_RE.test(sql) || HARD_SKIP_TABLE_RE.test(sql);
}

function recordSlot(
  slotStats: Map<number, SlotStats>,
  slot: SqlAnalysisLiteralSlot,
  redactors: RegExp[],
  rowStartedAt: string,
): void {
  const existing = slotStats.get(slot.position) ?? {
    position: slot.position,
    type: slot.type,
    values: new Map<string, number>(),
    observations: [],
  };
  const persistedValue = redactText(slot.exampleValue, redactors);
  existing.values.set(persistedValue, (existing.values.get(persistedValue) ?? 0) + 1);
  existing.observations.push({ value: persistedValue, rowStartedAt });
  slotStats.set(slot.position, existing);
}

function expandCategoricalTemplates(groups: TemplateAccumulator[], redactors: RegExp[]): TemplateVariant[] {
  return groups.flatMap((group) => expandTemplateGroup(group, redactors));
}

function expandTemplateGroup(group: TemplateAccumulator, redactors: RegExp[]): TemplateVariant[] {
  const rows = [...group.rows].sort((left, right) => left.row.startedAt.localeCompare(right.row.startedAt));
  const firstSeen = rows[0]?.row.startedAt;
  if (!firstSeen) {
    return [];
  }

  const slotClassifications = classifySlots(group.slotStats, rows.length, firstSeen);
  const categoricalPositions = slotClassifications
    .filter((slot) => slot.classification === 'categorical')
    .map((slot) => slot.position)
    .sort((left, right) => left - right);

  if (categoricalPositions.length === 0) {
    return [
      {
        id: group.fingerprint,
        fingerprint: group.fingerprint,
        subClusterId: null,
        normalizedSql: group.normalizedSql,
        tablesTouched: group.tablesTouched,
        rows,
        slotStats: group.slotStats,
        slotClassifications,
      },
    ];
  }

  const byTuple = new Map<
    string,
    {
      tuple: CategoricalTupleEntry[];
      rows: Array<{ row: HistoricSqlRawQueryRow; analysis: SqlAnalysisFingerprintResult }>;
    }
  >();

  for (const entry of rows) {
    const tuple = categoricalTuple(entry.analysis.literalSlots, categoricalPositions, redactors);
    const key = JSON.stringify(tuple);
    const existing = byTuple.get(key) ?? { tuple, rows: [] };
    existing.rows.push(entry);
    byTuple.set(key, existing);
  }

  return [...byTuple.values()]
    .map(({ tuple, rows: tupleRows }) => {
      const subClusterId = subClusterIdForTuple(tuple);
      return {
        id: `${group.fingerprint}__${subClusterId}`,
        fingerprint: group.fingerprint,
        subClusterId,
        normalizedSql: group.normalizedSql,
        tablesTouched: group.tablesTouched,
        rows: tupleRows,
        slotStats: collectSlotStats(tupleRows, redactors),
        slotClassifications,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function classifySlots(
  slotStats: Map<number, SlotStats>,
  executions: number,
  firstSeen: string,
): ClassifiedLiteralSlot[] {
  return [...slotStats.values()]
    .sort((left, right) => left.position - right.position)
    .map((slot) => ({
      position: slot.position,
      type: slot.type,
      classification: classifySlot(slot, executions, firstSeen),
    }));
}

function collectSlotStats(
  rows: Array<{ row: HistoricSqlRawQueryRow; analysis: SqlAnalysisFingerprintResult }>,
  redactors: RegExp[],
): Map<number, SlotStats> {
  const slotStats = new Map<number, SlotStats>();
  for (const entry of rows) {
    for (const slot of entry.analysis.literalSlots) {
      recordSlot(slotStats, slot, redactors, entry.row.startedAt);
    }
  }
  return slotStats;
}

function categoricalTuple(
  literalSlots: SqlAnalysisLiteralSlot[],
  categoricalPositions: number[],
  redactors: RegExp[],
): CategoricalTupleEntry[] {
  const valuesByPosition = new Map(
    literalSlots.map((slot) => [slot.position, redactText(slot.exampleValue, redactors)] as const),
  );
  return categoricalPositions.map((position) => ({
    position,
    value: valuesByPosition.get(position) ?? '<missing>',
  }));
}

function subClusterIdForTuple(tuple: CategoricalTupleEntry[]): string {
  return `cat_${createHash('sha256').update(JSON.stringify(tuple)).digest('hex').slice(0, 12)}`;
}

function buildStagedTemplate(
  template: TemplateVariant,
  config: HistoricSqlPullConfig,
  redaction: RedactionPolicy,
  now: Date,
): { metadata: HistoricSqlMetadata; pageMarkdown: string; usage: HistoricSqlUsage } {
  const rows = template.rows
    .map((entry) => entry.row)
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  const firstSeen = rows[0].startedAt;
  const lastSeen = rows[rows.length - 1].startedAt;
  const distinctUsers = new Set(rows.map((row) => row.user).filter((user): user is string => !!user)).size;
  const errorCount = rows.filter((row) => !row.success).length;
  const runtimes = rows
    .map((row) => row.runtimeMs)
    .filter((runtime): runtime is number => typeof runtime === 'number')
    .sort((left, right) => left - right);
  const triageSignals = buildTriageSignals({
    executions: rows.length,
    distinctUsers,
    errorRate: rows.length === 0 ? 0 : errorCount / rows.length,
    lastSeen,
    now,
    serviceAccountOnly: isServiceAccountOnly(rows, config.serviceAccountUserPatterns),
    slotClassifications: template.slotClassifications.map((slot) => slot.classification),
  });
  const tablesTouched = [...template.tablesTouched].sort();
  const firstTable = tablesTouched[0] ?? 'query';
  const id = template.id;
  const rowsProduced = sumRowsProduced(rows);
  const metadata: HistoricSqlMetadata = {
    id,
    title: buildTemplateTitle(config.dialect, firstTable, template.fingerprint, template.subClusterId),
    path: `templates/${id}/page.md`,
    objectType: HISTORIC_SQL_OBJECT_TYPE,
    lastEditedAt: null,
    properties: {
      fingerprint: template.fingerprint,
      sub_cluster_id: template.subClusterId,
      dialect: config.dialect,
      tables_touched: tablesTouched,
      literal_slots: template.slotClassifications,
      triage_signals: triageSignals,
    },
  };

  return {
    metadata,
    pageMarkdown: renderTemplatePage(id, template.normalizedSql, tablesTouched),
    usage: {
      stats: {
        executions: rows.length,
        distinct_users: distinctUsers,
        first_seen: firstSeen,
        last_seen: lastSeen,
        p50_runtime_ms: percentile(runtimes, 0.5),
        p95_runtime_ms: percentile(runtimes, 0.95),
        error_rate: rows.length === 0 ? 0 : errorCount / rows.length,
        ...(rowsProduced === null ? {} : { rows_produced: rowsProduced }),
      },
      literal_slots: [...template.slotStats.values()]
        .sort((left, right) => left.position - right.position)
        .map((slot) => ({
          position: slot.position,
          distinct_values: slot.values.size,
          top_values: [...slot.values.entries()]
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
            .slice(0, 10),
        })),
      samples: selectSamples(template.rows, redaction),
    },
  };
}

const TEMPORAL_SLOT_TYPES = new Set<SqlAnalysisLiteralSlotType>(['date', 'timestamp']);

function isStaleDateConstant(slot: SlotStats, value: string, firstSeen: string): boolean {
  return slot.type === 'date' && parseTemporalSlotValue(value) !== null && value < firstSeen.slice(0, 10);
}

function isMovingTemporalSlot(slot: SlotStats): boolean {
  if (!TEMPORAL_SLOT_TYPES.has(slot.type) || slot.values.size < 2) {
    return false;
  }

  const observations: Array<{ rowStartedAt: number; literalTime: number }> = [];
  for (const observation of slot.observations) {
    const rowStartedAt = Date.parse(observation.rowStartedAt);
    const literalTime = parseTemporalSlotValue(observation.value);
    if (Number.isNaN(rowStartedAt) || literalTime === null) {
      return false;
    }
    observations.push({ rowStartedAt, literalTime });
  }

  const literalTimes = observations
    .sort((left, right) => left.rowStartedAt - right.rowStartedAt)
    .map((observation) => observation.literalTime);

  return isMonotonic(literalTimes);
}

function parseTemporalSlotValue(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function isMonotonic(values: number[]): boolean {
  if (values.length < 2) {
    return false;
  }

  let nonDecreasing = true;
  let nonIncreasing = true;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] < values[index - 1]) {
      nonDecreasing = false;
    }
    if (values[index] > values[index - 1]) {
      nonIncreasing = false;
    }
  }

  return nonDecreasing || nonIncreasing;
}

function classifySlot(
  slot: SlotStats,
  executions: number,
  firstSeen: string,
): HistoricSqlLiteralSlotClassification {
  const ordered = [...slot.values.entries()].sort((left, right) => right[1] - left[1]);
  const distinct = ordered.length;
  const topCount = ordered[0]?.[1] ?? 0;
  const topValue = ordered[0]?.[0] ?? '';
  const staleDateConstant = isStaleDateConstant(slot, topValue, firstSeen);

  if (distinct === 1 && !staleDateConstant) {
    return 'constant';
  }
  if (executions > 0 && topCount / executions >= 0.95 && !staleDateConstant) {
    return 'constant';
  }
  if (isMovingTemporalSlot(slot)) {
    return 'runtime';
  }
  if (executions > 0 && distinct >= 2 && distinct <= 10 && ordered.every(([, count]) => count / executions >= 0.05)) {
    return 'categorical';
  }
  return 'runtime';
}

function buildTriageSignals(input: {
  executions: number;
  distinctUsers: number;
  errorRate: number;
  lastSeen: string;
  now: Date;
  serviceAccountOnly: boolean;
  slotClassifications: HistoricSqlLiteralSlotClassification[];
}): Record<string, string> {
  const runtimeCount = input.slotClassifications.filter((classification) => classification === 'runtime').length;
  const constantCount = input.slotClassifications.filter((classification) => classification === 'constant').length;
  return {
    executions_bucket: input.executions < 3 ? 'low' : input.executions < 50 ? 'mid' : 'high',
    distinct_users_bucket: input.distinctUsers <= 1 ? 'solo' : input.distinctUsers <= 5 ? 'team' : 'broad',
    error_rate_bucket: input.errorRate <= 0.01 ? 'ok' : input.errorRate <= 0.1 ? 'noisy' : 'broken',
    recency_bucket: recencyBucket(input.lastSeen, input.now),
    service_account_only: String(input.serviceAccountOnly),
    slot_summary: `${constantCount} constant, ${runtimeCount} runtime`,
  };
}

function recencyBucket(lastSeen: string, now: Date): string {
  const ageDays = Math.max(0, (now.getTime() - new Date(lastSeen).getTime()) / (24 * 60 * 60 * 1000));
  if (ageDays <= 14) {
    return 'active';
  }
  if (ageDays <= 60) {
    return 'warm';
  }
  return 'cold';
}

function isServiceAccountOnly(rows: HistoricSqlRawQueryRow[], patterns: string[]): boolean {
  const users = rows.map((row) => row.user).filter((user): user is string => !!user);
  if (users.length === 0 || patterns.length === 0) {
    return false;
  }
  const regexes = patterns.map((pattern) => new RegExp(pattern));
  return users.every((user) => regexes.some((regex) => regex.test(user)));
}

function buildTemplateTitle(
  dialect: HistoricSqlPullConfig['dialect'],
  firstTable: string,
  fingerprint: string,
  subClusterId: string | null,
): string {
  if (!subClusterId) {
    return `${dialect} · ${firstTable} [${fingerprint.slice(0, 6)}]`;
  }
  return `${dialect} · ${firstTable} [${fingerprint.slice(0, 6)}:${subClusterId.slice(-6)}]`;
}

function renderTemplatePage(fingerprint: string, normalizedSql: string, tablesTouched: string[]): string {
  return [
    `# ${fingerprint}`,
    '',
    '## Normalized SQL',
    '```sql',
    normalizedSql,
    '```',
    '',
    '## Tables touched',
    ...tablesTouched.map((table) => `- ${table}`),
    '',
  ].join('\n');
}

function selectSamples(
  rows: Array<{ row: HistoricSqlRawQueryRow; analysis: SqlAnalysisFingerprintResult }>,
  redaction: RedactionPolicy,
): HistoricSqlUsage['samples'] {
  if (!redaction.samplesAllowed) {
    return [];
  }

  const byLiteralTuple = new Map<string, { row: HistoricSqlRawQueryRow; analysis: SqlAnalysisFingerprintResult }>();
  const preferred = [...rows].sort((left, right) => {
    if (left.row.success !== right.row.success) {
      return left.row.success ? -1 : 1;
    }
    return right.row.startedAt.localeCompare(left.row.startedAt);
  });

  for (const entry of preferred) {
    const key = [...entry.analysis.literalSlots]
      .sort((left, right) => left.position - right.position)
      .map((slot) => slot.exampleValue)
      .join('\u001f');
    if (!byLiteralTuple.has(key)) {
      byLiteralTuple.set(key, entry);
    }
  }

  return [...byLiteralTuple.values()]
    .sort((left, right) => right.row.startedAt.localeCompare(left.row.startedAt))
    .slice(0, 5)
    .map(({ row }) => ({
      started_at: row.startedAt,
      user: row.user,
      bound_sql: redactText(row.sql, redaction.redactors),
      ...(row.rowsProduced === undefined ? {} : { rows_produced: row.rowsProduced ?? null }),
      runtime_ms: row.runtimeMs,
      success: row.success,
    }));
}

function selectTemplates(templates: TemplateVariant[], maxTemplatesPerRun: number, now: Date): TemplateVariant[] {
  return templates
    .map((template) => ({ template, score: rankTemplate(template, now) }))
    .sort((left, right) => right.score - left.score || left.template.id.localeCompare(right.template.id))
    .slice(0, maxTemplatesPerRun)
    .map((entry) => entry.template);
}

function rankTemplate(template: TemplateVariant, now: Date): number {
  const users = new Set(template.rows.map(({ row }) => row.user).filter((user): user is string => !!user)).size;
  const latestStartedAt = template.rows.reduce<string | null>(
    (latest, { row }) => (latest === null || row.startedAt > latest ? row.startedAt : latest),
    null,
  );
  const ageDays =
    latestStartedAt === null ? 365 : Math.max(0, (now.getTime() - new Date(latestStartedAt).getTime()) / 86400000);
  const recencyWeight = 1 / (1 + ageDays / 30);
  return users * Math.log1p(template.rows.length) * recencyWeight;
}

function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * percentileValue) - 1));
  return values[index];
}

function sumRowsProduced(rows: HistoricSqlRawQueryRow[]): number | null {
  const values = rows.map((row) => row.rowsProduced).filter((value): value is number => typeof value === 'number');
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null;
}

function compileRedactors(patterns: string[], warnings: string[]): RedactionPolicy {
  let samplesAllowed = true;
  const redactors = patterns.flatMap((pattern) => {
    try {
      return [new RegExp(pattern, 'g')];
    } catch (error) {
      samplesAllowed = false;
      warnings.push(
        `redaction_skipped:invalid_redaction_pattern:${pattern}:${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  });
  return { redactors, samplesAllowed };
}

function redactText(value: string, redactors: RegExp[]): string {
  return redactors.reduce((current, regex) => current.replace(regex, '<redacted>'), value);
}

async function writeJson(stagedDir: string, relPath: string, value: unknown): Promise<void> {
  await writeText(stagedDir, relPath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(stagedDir: string, relPath: string, value: string): Promise<void> {
  const target = join(stagedDir, relPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, value, 'utf-8');
}

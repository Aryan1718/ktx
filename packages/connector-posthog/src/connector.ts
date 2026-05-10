import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { assertReadOnlySql, limitSqlForExecution } from '@klo/context/connections';
import {
  createKloConnectorCapabilities,
  type KloColumnSampleInput,
  type KloColumnSampleResult,
  type KloColumnStatsInput,
  type KloColumnStatsResult,
  type KloEventPropertyDiscovery,
  type KloEventPropertyDiscoveryInput,
  type KloEventPropertyValuesInput,
  type KloEventPropertyValuesResult,
  type KloEventStreamDiscoveryPort,
  type KloEventTypeDiscovery,
  type KloEventTypeDiscoveryInput,
  type KloQueryResult,
  type KloReadOnlyQueryInput,
  type KloScanConnector,
  type KloScanContext,
  type KloScanInput,
  type KloSchemaColumn,
  type KloSchemaSnapshot,
  type KloSchemaTable,
  type KloTableRef,
  type KloTableSampleInput,
  type KloTableSampleResult,
} from '@klo/context/scan';
import { KloPostHogDialect, type KloPostHogSampleColumnInfo } from './dialect.js';
import { getKloPostHogColumnDescription, getKloPostHogTableDescription } from './schema-descriptions.js';

export interface KloPostHogConnectionConfig {
  driver?: string;
  api_key?: string;
  apiKey?: string;
  project_id?: string;
  projectId?: string;
  region?: 'us' | 'eu';
  host?: string;
  readonly?: boolean;
  [key: string]: unknown;
}

export interface KloPostHogResolvedConnectionConfig {
  apiKey: string;
  projectId: string;
  baseUrl: string;
}

export type KloPostHogFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface KloPostHogScanConnectorOptions {
  connectionId: string;
  connection: KloPostHogConnectionConfig | undefined;
  env?: NodeJS.ProcessEnv;
  fetch?: KloPostHogFetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

export interface KloPostHogReadOnlyQueryInput extends KloReadOnlyQueryInput {
  params?: Record<string, unknown>;
}

export interface KloPostHogColumnDistinctValuesOptions {
  maxCardinality: number;
  limit: number;
  sampleSize?: number;
}

export interface KloPostHogColumnDistinctValuesResult {
  values: string[] | null;
  cardinality: number;
}

interface PostHogSchemaField {
  name: string;
  type: string;
  hogql_value: string;
  schema_valid: boolean;
  table: string | null;
  fields: string[] | null;
  chain: string[] | null;
  id: string | null;
}

interface PostHogSchemaTable {
  id: string;
  name: string;
  type: string;
  row_count: number | null;
  fields: Record<string, PostHogSchemaField>;
}

interface PostHogSchemaResponse {
  tables: Record<string, PostHogSchemaTable>;
  joins: unknown[];
}

interface PostHogQueryResponse {
  results: unknown[][] | null;
  columns: string[] | null;
  types: [string, string][] | null;
  error: string | null;
  hogql: string | null;
}

const allowedTableTypes = new Set(['posthog', 'system']);
const excludedTables = new Set([
  'query_log',
  'system.teams',
  'system.exports',
  'system.ingestion_warnings',
  'system.insight_variables',
  'system.data_warehouse_sources',
  'system.groups',
  'system.group_type_mappings',
]);
const hiddenTablesToProbe = ['person_distinct_ids', 'cohort_people', 'static_cohort_people'];

export function isKloPostHogConnectionConfig(connection: KloPostHogConnectionConfig | undefined): boolean {
  return String(connection?.driver ?? '').toLowerCase() === 'posthog';
}

function resolveStringReference(value: string, env: NodeJS.ProcessEnv): string {
  if (value.startsWith('env:')) {
    return env[value.slice('env:'.length)] ?? '';
  }
  if (value.startsWith('file:')) {
    const rawPath = value.slice('file:'.length);
    const path = rawPath.startsWith('~') ? resolve(homedir(), rawPath.slice(1)) : rawPath;
    return readFileSync(path, 'utf-8').trim();
  }
  return value;
}

function stringConfigValue(
  connection: KloPostHogConnectionConfig | undefined,
  key: keyof KloPostHogConnectionConfig,
  env: NodeJS.ProcessEnv,
): string | undefined {
  const value = connection?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? resolveStringReference(value.trim(), env) : undefined;
}

export function postHogConnectionConfigFromConfig(input: {
  connectionId: string;
  connection: KloPostHogConnectionConfig | undefined;
  env?: NodeJS.ProcessEnv;
}): KloPostHogResolvedConnectionConfig {
  if (!isKloPostHogConnectionConfig(input.connection)) {
    throw new Error(`Native PostHog connector cannot run driver "${input.connection?.driver ?? 'unknown'}"`);
  }
  if (input.connection?.readonly !== true) {
    throw new Error(`Native PostHog connector requires connections.${input.connectionId}.readonly: true`);
  }
  const env = input.env ?? process.env;
  const apiKey = stringConfigValue(input.connection, 'api_key', env) ?? stringConfigValue(input.connection, 'apiKey', env);
  const projectId =
    stringConfigValue(input.connection, 'project_id', env) ?? stringConfigValue(input.connection, 'projectId', env);
  if (!apiKey) {
    throw new Error(`Native PostHog connector requires connections.${input.connectionId}.api_key`);
  }
  if (!projectId) {
    throw new Error(`Native PostHog connector requires connections.${input.connectionId}.project_id`);
  }
  const host = stringConfigValue(input.connection, 'host', env);
  const region = input.connection?.region ?? 'us';
  return {
    apiKey,
    projectId,
    baseUrl: host ? host.replace(/\/$/, '') : region === 'eu' ? 'https://eu.posthog.com' : 'https://us.posthog.com',
  };
}

export class KloPostHogScanConnector implements KloScanConnector {
  readonly id: string;
  readonly driver = 'posthog' as const;
  readonly capabilities = createKloConnectorCapabilities({
    tableSampling: true,
    columnSampling: true,
    columnStats: false,
    readOnlySql: true,
    nestedAnalysis: true,
    eventStreamDiscovery: true,
    formalForeignKeys: false,
    estimatedRowCounts: true,
  });

  readonly eventStreamDiscovery: KloEventStreamDiscoveryPort = {
    listEventTypes: (input, ctx) => this.listEventTypes(input, ctx),
    listPropertyKeys: (input, ctx) => this.listPropertyKeys(input, ctx),
    listPropertyValues: (input, ctx) => this.listPropertyValues(input, ctx),
  };

  private readonly connectionId: string;
  private readonly resolved: KloPostHogResolvedConnectionConfig;
  private readonly fetchImpl: KloPostHogFetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;
  private readonly dialect = new KloPostHogDialect();

  constructor(options: KloPostHogScanConnectorOptions) {
    this.connectionId = options.connectionId;
    this.resolved = postHogConnectionConfigFromConfig({
      connectionId: options.connectionId,
      connection: options.connection,
      env: options.env,
    });
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)));
    this.now = options.now ?? (() => new Date());
    this.id = `posthog:${options.connectionId}`;
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    const response = await this.query('SELECT 1 AS test');
    return response.error ? { success: false, error: response.error } : { success: true };
  }

  async introspect(input: KloScanInput, _ctx: KloScanContext): Promise<KloSchemaSnapshot> {
    this.assertConnection(input.connectionId);
    const response = await this.makeRequest<PostHogSchemaResponse>('/query', { query: { kind: 'DatabaseSchemaQuery' } });
    const tables: KloSchemaTable[] = [];
    for (const [tableName, tableInfo] of Object.entries(response.tables ?? {})) {
      if (!allowedTableTypes.has(tableInfo.type) || excludedTables.has(tableName)) {
        continue;
      }
      tables.push(this.toSchemaTable(tableName, tableInfo));
    }
    tables.push(...(await this.discoverHiddenTables()));
    tables.sort((left, right) => left.name.localeCompare(right.name));
    return {
      connectionId: this.connectionId,
      driver: 'posthog',
      extractedAt: this.now().toISOString(),
      scope: { catalogs: [this.resolved.projectId] },
      metadata: {
        project_id: this.resolved.projectId,
        table_count: tables.length,
        total_columns: tables.reduce((sum, table) => sum + table.columns.length, 0),
      },
      tables,
    };
  }

  async sampleTable(
    input: KloTableSampleInput & { columnMetadata?: KloPostHogSampleColumnInfo[] },
    _ctx: KloScanContext,
  ): Promise<KloTableSampleResult> {
    this.assertConnection(input.connectionId);
    const sql = input.columnMetadata
      ? this.dialect.generateSampleQueryWithMetadata(this.qTableName(input.table), input.limit, input.columnMetadata)
      : this.dialect.generateSampleQuery(this.qTableName(input.table), input.limit, input.columns);
    const result = await this.query(sql);
    return { headers: result.headers, rows: result.rows, totalRows: result.totalRows };
  }

  async sampleColumn(input: KloColumnSampleInput, _ctx: KloScanContext): Promise<KloColumnSampleResult> {
    this.assertConnection(input.connectionId);
    const result = await this.query(
      this.dialect.generateColumnSampleQuery(this.qTableName(input.table), input.column, input.limit),
    );
    const values = result.rows.filter((row) => row.length > 0 && row[0] !== null).map((row) => row[0]);
    return { values, nullCount: null, distinctCount: null };
  }

  async columnStats(_input: KloColumnStatsInput, _ctx: KloScanContext): Promise<KloColumnStatsResult | null> {
    return null;
  }

  async executeReadOnly(input: KloPostHogReadOnlyQueryInput, _ctx: KloScanContext): Promise<KloQueryResult> {
    this.assertConnection(input.connectionId);
    const limitedSql = limitSqlForExecution(assertReadOnlySql(input.sql), input.maxRows);
    const prepared = this.dialect.prepareQuery(limitedSql, input.params);
    const result = await this.query(prepared.sql, prepared.params);
    return { ...result, rowCount: result.rows.length };
  }

  async getTableRowCount(tableName: string): Promise<number> {
    const result = await this.query(`SELECT count() AS cnt FROM ${this.dialect.quoteIdentifier(tableName)}`);
    return Number(result.rows[0]?.[0] ?? 0);
  }

  async getColumnDistinctValues(
    table: KloTableRef,
    columnName: string,
    options: KloPostHogColumnDistinctValuesOptions,
  ): Promise<KloPostHogColumnDistinctValuesResult | null> {
    const sampleSize = options.sampleSize ?? 10000;
    const tableName = this.qTableName(table);
    const cardinalityResult = await this.query(
      this.dialect.generateCardinalitySampleQuery(tableName, columnName, sampleSize),
    );
    if (cardinalityResult.error || cardinalityResult.rows.length === 0) {
      return null;
    }
    const cardinality = Number(cardinalityResult.rows[0]?.[0]);
    if (!Number.isFinite(cardinality)) {
      return null;
    }
    if (cardinality === 0) {
      return { values: [], cardinality: 0 };
    }
    if (cardinality > options.maxCardinality) {
      return { values: null, cardinality };
    }
    const valuesResult = await this.query(this.dialect.generateDistinctValuesQuery(tableName, columnName, options.limit));
    if (valuesResult.error) {
      return null;
    }
    return {
      values: valuesResult.rows.filter((row) => row[0] !== null).map((row) => String(row[0])),
      cardinality,
    };
  }

  private async listEventTypes(
    input: KloEventTypeDiscoveryInput,
    _ctx: KloScanContext,
  ): Promise<KloEventTypeDiscovery[]> {
    this.assertConnection(input.connectionId);
    const limit = this.positiveInteger(input.limit, 'limit');
    const lookbackDays = this.positiveInteger(input.lookbackDays ?? 30, 'lookbackDays');
    const minCount = this.positiveInteger(input.minCount ?? 0, 'minCount');
    const eventColumn = this.dialect.quoteIdentifier(input.eventColumn);
    const tableName = this.qTableName(input.table);
    const havingClause = minCount > 0 ? `HAVING cnt >= ${minCount}` : '';
    const result = await this.query(`
      SELECT ${eventColumn} AS event, count() as cnt
      FROM ${tableName}
      WHERE timestamp > now() - INTERVAL ${lookbackDays} DAY
      GROUP BY event
      ${havingClause}
      ORDER BY cnt DESC
      LIMIT ${limit}
    `);
    if (result.error) {
      return [];
    }
    return result.rows
      .filter((row) => row[0] != null && String(row[0]).trim() !== '')
      .map((row) => ({ value: String(row[0]), count: Number(row[1]) }));
  }

  private async listPropertyKeys(
    input: KloEventPropertyDiscoveryInput,
    _ctx: KloScanContext,
  ): Promise<KloEventPropertyDiscovery[]> {
    this.assertConnection(input.connectionId);
    const sampleSize = this.positiveInteger(input.sampleSize, 'sampleSize');
    const limit = this.positiveInteger(input.limit, 'limit');
    const lookbackDays = input.lookbackDays === undefined ? null : this.positiveInteger(input.lookbackDays, 'lookbackDays');
    const tableName = this.qTableName(input.table);
    const jsonColumn = this.dialect.quoteIdentifier(input.jsonColumn);
    const whereClause = lookbackDays === null ? '' : `WHERE timestamp > now() - INTERVAL ${lookbackDays} DAY`;
    const result = await this.query(`
      SELECT key, count() as cnt
      FROM (
        SELECT arrayJoin(JSONExtractKeys(${jsonColumn})) AS key
        FROM ${tableName}
        ${whereClause}
        LIMIT ${sampleSize}
      )
      GROUP BY key
      ORDER BY cnt DESC
      LIMIT ${limit}
    `);
    if (result.error) {
      return [];
    }
    return result.rows.map((row) => ({ key: String(row[0]), count: Number(row[1]) }));
  }

  private async listPropertyValues(
    input: KloEventPropertyValuesInput,
    _ctx: KloScanContext,
  ): Promise<KloEventPropertyValuesResult | null> {
    this.assertConnection(input.connectionId);
    const limit = this.positiveInteger(input.limit, 'limit');
    const maxCardinality = this.positiveInteger(input.maxCardinality ?? 1000, 'maxCardinality');
    const lookbackDays = input.lookbackDays === undefined ? null : this.positiveInteger(input.lookbackDays, 'lookbackDays');
    const tableName = this.qTableName(input.table);
    const jsonColumn = this.dialect.quoteIdentifier(input.jsonColumn);
    const escapedKey = this.escapeHogQLString(input.propertyKey);
    const timeFilter = lookbackDays === null ? '' : `WHERE timestamp > now() - INTERVAL ${lookbackDays} DAY`;
    const cardinalityResult = await this.query(`
      SELECT uniq(JSONExtractString(${jsonColumn}, '${escapedKey}')) as cardinality
      FROM ${tableName}
      ${timeFilter}
      LIMIT 1000000
    `);
    if (cardinalityResult.error || cardinalityResult.rows.length === 0) {
      return null;
    }
    const cardinality = Number(cardinalityResult.rows[0]?.[0]);
    if (!Number.isFinite(cardinality) || cardinality > maxCardinality) {
      return null;
    }
    const valuesResult = await this.query(`
      SELECT DISTINCT JSONExtractString(${jsonColumn}, '${escapedKey}') as value
      FROM ${tableName}
      WHERE JSONExtractString(${jsonColumn}, '${escapedKey}') IS NOT NULL
        AND JSONExtractString(${jsonColumn}, '${escapedKey}') != ''
        ${lookbackDays === null ? '' : `AND timestamp > now() - INTERVAL ${lookbackDays} DAY`}
      ORDER BY value
      LIMIT ${limit}
    `);
    if (valuesResult.error) {
      return null;
    }
    const values = valuesResult.rows
      .map((row) => (row[0] != null ? String(row[0]) : ''))
      .filter((value) => {
        const trimmed = value.trim();
        return trimmed !== '' && trimmed !== '[]' && trimmed !== '{}' && trimmed !== 'null';
      });
    return { values, cardinality };
  }

  async cleanup(): Promise<void> {}

  qTableName(table: Pick<KloTableRef, 'name'>): string {
    return this.dialect.formatTableName(table);
  }

  quoteIdentifier(identifier: string): string {
    return this.dialect.quoteIdentifier(identifier);
  }

  private toSchemaTable(tableName: string, tableInfo: PostHogSchemaTable): KloSchemaTable {
    return {
      catalog: this.resolved.projectId,
      db: null,
      name: tableName,
      kind: tableName === 'events' ? 'event_stream' : 'table',
      comment: getKloPostHogTableDescription(tableName) ?? null,
      estimatedRows: tableInfo.row_count ?? null,
      columns: this.extractColumns(tableName, tableInfo.fields),
      foreignKeys: [],
    };
  }

  private async discoverHiddenTables(): Promise<KloSchemaTable[]> {
    const tables: KloSchemaTable[] = [];
    for (const tableName of hiddenTablesToProbe) {
      const result = await this.query(`SELECT * FROM ${tableName} LIMIT 0`);
      if (result.error) {
        continue;
      }
      tables.push({
        catalog: this.resolved.projectId,
        db: null,
        name: tableName,
        kind: 'table',
        comment: getKloPostHogTableDescription(tableName) ?? null,
        estimatedRows: null,
        columns: result.headers.map((header) => ({
          name: header,
          nativeType: 'String',
          normalizedType: 'VARCHAR',
          dimensionType: 'string',
          nullable: true,
          primaryKey: false,
          comment: getKloPostHogColumnDescription(tableName, header) ?? null,
        })),
        foreignKeys: [],
      });
    }
    return tables;
  }

  private extractColumns(tableName: string, fields: Record<string, PostHogSchemaField>): KloSchemaColumn[] {
    const columns: KloSchemaColumn[] = [];
    for (const [fieldName, fieldInfo] of Object.entries(fields)) {
      if (
        fieldInfo.type === 'lazy_table' ||
        fieldInfo.type === 'virtual_table' ||
        fieldInfo.type === 'field_traverser' ||
        fieldInfo.type === 'expression'
      ) {
        continue;
      }
      const nativeType = this.normalizeFieldType(fieldInfo.type);
      columns.push({
        name: fieldName,
        nativeType,
        normalizedType: this.dialect.mapDataType(nativeType),
        dimensionType: this.dialect.mapToDimensionType(nativeType),
        nullable: this.isNullableField(tableName, fieldName, fieldInfo.type),
        primaryKey: this.isPrimaryKeyField(tableName, fieldName),
        comment: getKloPostHogColumnDescription(tableName, fieldName) ?? null,
      });
    }
    return columns;
  }

  private normalizeFieldType(posthogType: string): string {
    const typeMap: Record<string, string> = {
      string: 'String',
      integer: 'Int64',
      datetime: 'DateTime64',
      boolean: 'UInt8',
      bool: 'Boolean',
      json: 'JSON',
      array: 'Array(String)',
      uuid: 'UUID',
      event: 'String',
    };
    return typeMap[posthogType.toLowerCase()] ?? posthogType;
  }

  private isNullableField(tableName: string, fieldName: string, fieldType: string): boolean {
    if (tableName === 'events' && ['uuid', 'event', 'timestamp', 'distinct_id'].includes(fieldName)) {
      return false;
    }
    return !['uuid', 'event', 'timestamp', 'distinct_id'].includes(fieldType.toLowerCase());
  }

  private isPrimaryKeyField(tableName: string, fieldName: string): boolean {
    return (
      (tableName === 'events' && fieldName === 'uuid') ||
      (tableName === 'persons' && fieldName === 'id') ||
      (tableName === 'sessions' && fieldName === 'session_id') ||
      (tableName === 'groups' && fieldName === 'key')
    );
  }

  private async query(sql: string, params?: Record<string, unknown>): Promise<KloQueryResult & { error?: string }> {
    const response = await this.makeRequest<PostHogQueryResponse>('/query', {
      query: {
        kind: 'HogQLQuery',
        query: sql,
        ...(params && Object.keys(params).length > 0 ? { values: params } : {}),
      },
    });
    if (response.error) {
      return { headers: [], rows: [], totalRows: 0, rowCount: null, error: response.error };
    }
    const headers = response.columns ?? [];
    const rows = response.results ?? [];
    const headerTypes = response.types?.map((type) => type[1]);
    return {
      headers,
      rows,
      totalRows: rows.length,
      rowCount: rows.length,
      ...(headerTypes && headerTypes.length > 0 ? { headerTypes } : {}),
    };
  }

  private async makeRequest<T>(endpoint: string, body: Record<string, unknown>, maxRetries = 3): Promise<T> {
    const url = `${this.resolved.baseUrl}/api/projects/${this.resolved.projectId}${endpoint}`;
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.resolved.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        return response.json() as Promise<T>;
      }
      const errorText = await response.text();
      const errorMessage = this.parseErrorMessage(errorText);
      if (response.status === 429 && attempt < maxRetries) {
        await this.sleep(this.parseRateLimitWaitTime(errorMessage) * 1000);
        continue;
      }
      lastError = new Error(`PostHog API error (${response.status}): ${errorMessage}`);
    }
    throw lastError ?? new Error('PostHog API request failed after retries');
  }

  private parseErrorMessage(errorText: string): string {
    try {
      const errorJson = JSON.parse(errorText) as { detail?: unknown; error?: unknown };
      return String(errorJson.detail ?? errorJson.error ?? errorText);
    } catch {
      return errorText;
    }
  }

  private parseRateLimitWaitTime(errorMessage: string): number {
    const match = errorMessage.match(/(?:Expected available in|retry after) (\d+) seconds?/i);
    return match ? Number.parseInt(match[1] ?? '30', 10) + 2 : 30;
  }

  private escapeHogQLString(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "''");
  }

  private positiveInteger(value: number, name: string): number {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`PostHog event-stream discovery requires ${name} to be a non-negative integer`);
    }
    return value;
  }

  private assertConnection(connectionId: string): void {
    if (connectionId !== this.connectionId) {
      throw new Error(`PostHog connector ${this.connectionId} cannot scan connection ${connectionId}`);
    }
  }
}

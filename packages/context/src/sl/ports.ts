import type { SemanticLayerQueryInput, SemanticLayerSource } from './types.js';

export interface KloConnectionInfo {
  id: string;
  name: string;
  connectionType: string;
}

export interface KloQueryResult {
  headers?: string[];
  rows?: unknown[][];
  totalRows?: number;
}

export interface SlConnectionCatalogPort {
  listEnabledConnections(ids: string[]): Promise<KloConnectionInfo[]>;
  getConnectionById(connectionId: string): Promise<KloConnectionInfo | null>;
  executeQuery(connectionId: string, sql: string): Promise<KloQueryResult>;
}

export interface SlPythonPort {
  validateSources(input: {
    sources: SemanticLayerSource[];
    dialect: string;
    recently_touched?: string[];
  }): Promise<{
    data?: { errors?: string[]; warnings?: string[]; per_source_warnings?: Record<string, string[]> } | null;
    error?: unknown;
  }>;
  query(input: {
    sources: SemanticLayerSource[];
    query: SemanticLayerQueryInput;
    dialect: string;
  }): Promise<{ data?: { sql?: string; plan?: Record<string, unknown> } | null; error?: unknown }>;
}

export interface SlSourcesIndexPort {
  upsertSources(
    connectionId: string,
    sources: Array<{ sourceName: string; searchText: string; embedding: number[] | null; contentHash?: string | null }>,
  ): Promise<void>;
  getExistingSearchTexts(connectionId: string): Promise<Map<string, { searchText: string; hasEmbedding: boolean }>>;
  deleteStale(connectionId: string, keepNames: string[]): Promise<void>;
  deleteByConnection(connectionId: string): Promise<void>;
  deleteByConnectionAndName(connectionId: string, sourceName: string): Promise<void>;
  search(
    connectionId: string,
    queryEmbedding: number[] | null,
    queryText: string,
    limit: number,
    minRrfScore?: number,
  ): Promise<Array<{ sourceName: string; rrfScore: number }>>;
}

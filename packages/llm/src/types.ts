import type { LanguageModel, TelemetrySettings, ToolCallRepairFunction, ToolSet } from 'ai';

export const KLO_MODEL_ROLES = ['default', 'triage', 'candidateExtraction', 'curator', 'reconcile', 'repair'] as const;

export type KloModelRole = (typeof KLO_MODEL_ROLES)[number];
export type KloLlmBackend = 'anthropic' | 'vertex' | 'gateway';
export type KloPromptCacheTtl = '5m' | '1h';

export type KloJsonValue =
  | null
  | string
  | number
  | boolean
  | KloJsonValue[]
  | { [key: string]: KloJsonValue | undefined };

export type KloProviderOptions = Record<string, { [key: string]: KloJsonValue | undefined }>;

export interface KloPromptCachingConfig {
  enabled: boolean;
  systemTtl: KloPromptCacheTtl;
  toolsTtl: KloPromptCacheTtl;
  historyTtl: KloPromptCacheTtl;
  cacheSystem: boolean;
  cacheTools: boolean;
  cacheHistory: boolean;
  vertexFallbackTo5m: boolean;
}

export interface KloTokenUsageEvent {
  source?: string;
  modelId?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface KloLlmConfig {
  backend: KloLlmBackend;
  vertex?: { project?: string; location: string };
  anthropic?: { apiKey?: string; baseURL?: string };
  gateway?: { baseURL?: string; apiKey?: string };
  modelSlots: { default: string } & Partial<Record<KloModelRole, string>>;
  promptCaching?: Partial<KloPromptCachingConfig>;
  telemetry?: {
    experimentalTelemetry?: TelemetrySettings;
    onTokenUsage?: (event: KloTokenUsageEvent) => void;
  };
}

export interface KloLlmProvider {
  getModel(role: KloModelRole): LanguageModel;
  getModelByName(modelId: string): LanguageModel;
  cacheMarker(
    ttl: KloPromptCacheTtl,
    model?: LanguageModel | string,
  ): { anthropic: { cacheControl: { type: 'ephemeral'; ttl: KloPromptCacheTtl } } } | undefined;
  repairToolCallHandler(options?: { source?: string }): ToolCallRepairFunction<ToolSet>;
  thinkingProviderOptions(role: KloModelRole, budgetTokens: number): KloProviderOptions;
  telemetryConfig(): TelemetrySettings | undefined;
  promptCachingConfig(): KloPromptCachingConfig;
  activeBackend(): KloLlmBackend;
}

export type KloEmbeddingBackend = 'openai' | 'deterministic' | 'sentence-transformers';

export interface KloEmbeddingTokenUsageEvent {
  backend: KloEmbeddingBackend;
  model: string;
  inputCount: number;
  totalTokens?: number;
}

export interface KloEmbeddingConfig {
  backend: KloEmbeddingBackend;
  model: string;
  dimensions: number;
  openai?: { apiKey?: string; baseURL?: string };
  sentenceTransformers?: { baseURL: string; pathPrefix?: string };
  batchSize?: number;
  telemetry?: { onTokenUsage?: (event: KloEmbeddingTokenUsageEvent) => void };
}

export interface KloEmbeddingProvider {
  readonly dimensions: number;
  readonly maxBatchSize: number;
  embed(text: string): Promise<number[]>;
  embedMany(texts: string[]): Promise<number[][]>;
}

export interface KloPromptParts {
  staticSystem: string;
  dynamicSystem?: string;
  leadingUserContext?: string;
}

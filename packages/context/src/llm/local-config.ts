import {
  createKloEmbeddingProvider,
  createKloLlmProvider,
  type KloEmbeddingConfig,
  type KloEmbeddingProvider,
  type KloLlmConfig,
  type KloLlmProvider,
  type KloModelRole,
} from '@klo/llm';
import { resolveKloConfigReference } from '../core/config-reference.js';
import type { KloProjectEmbeddingConfig, KloProjectLlmConfig } from '../project/config.js';

interface LocalConfigDeps {
  env?: NodeJS.ProcessEnv;
  createKloLlmProvider?: typeof createKloLlmProvider;
  createKloEmbeddingProvider?: typeof createKloEmbeddingProvider;
}

function resolveOptional(value: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
  return resolveKloConfigReference(value, env) || undefined;
}

function resolveRequired(value: string | undefined, env: NodeJS.ProcessEnv, message: string): string {
  const resolved = resolveOptional(value, env);
  if (!resolved) {
    throw new Error(message);
  }
  return resolved;
}

function resolveModelSlots(
  models: KloProjectLlmConfig['models'],
  env: NodeJS.ProcessEnv,
): KloLlmConfig['modelSlots'] {
  const resolved: Partial<Record<KloModelRole, string>> & { default?: string } = {};
  for (const [role, value] of Object.entries(models)) {
    if (value) {
      resolved[role as KloModelRole] = resolveRequired(value, env, `llm.models.${role} is required`);
    }
  }
  if (!resolved.default) {
    throw new Error('llm.models.default is required when llm.provider.backend is not none');
  }
  return resolved as KloLlmConfig['modelSlots'];
}

function resolvedProviderConfig(
  config: { api_key?: string; base_url?: string } | undefined,
  env: NodeJS.ProcessEnv,
): { apiKey?: string; baseURL?: string } | undefined {
  if (!config) {
    return undefined;
  }

  const apiKey = resolveOptional(config.api_key, env);
  const baseURL = resolveOptional(config.base_url, env);
  if (!apiKey && !baseURL) {
    return undefined;
  }

  return {
    ...(apiKey ? { apiKey } : {}),
    ...(baseURL ? { baseURL } : {}),
  };
}

export function resolveLocalKloLlmConfig(config: KloProjectLlmConfig, env: NodeJS.ProcessEnv): KloLlmConfig | null {
  if (config.provider.backend === 'none') {
    return null;
  }
  const modelSlots = resolveModelSlots(config.models, env);
  const anthropic = resolvedProviderConfig(config.provider.anthropic, env);
  const gateway = resolvedProviderConfig(config.provider.gateway, env);
  return {
    backend: config.provider.backend,
    ...(config.provider.vertex ? { vertex: config.provider.vertex } : {}),
    ...(anthropic ? { anthropic } : {}),
    ...(gateway ? { gateway } : {}),
    modelSlots,
    promptCaching: config.promptCaching,
  };
}

export function createLocalKloLlmProviderFromConfig(
  config: KloProjectLlmConfig,
  deps: LocalConfigDeps = {},
): KloLlmProvider | null {
  const resolved = resolveLocalKloLlmConfig(config, deps.env ?? process.env);
  return resolved ? (deps.createKloLlmProvider ?? createKloLlmProvider)(resolved) : null;
}

export function resolveLocalKloEmbeddingConfig(
  config: KloProjectEmbeddingConfig,
  env: NodeJS.ProcessEnv,
): KloEmbeddingConfig | null {
  if (config.backend === 'none') {
    return null;
  }
  return {
    backend: config.backend,
    model: config.model ?? 'deterministic',
    dimensions: config.dimensions,
    ...(resolvedProviderConfig(config.openai, env) ? { openai: resolvedProviderConfig(config.openai, env) } : {}),
    ...(config.sentenceTransformers
      ? {
          sentenceTransformers: {
            baseURL: config.sentenceTransformers.base_url,
            pathPrefix: config.sentenceTransformers.pathPrefix,
          },
        }
      : {}),
    batchSize: config.batchSize,
  };
}

export function createLocalKloEmbeddingProviderFromConfig(
  config: KloProjectEmbeddingConfig,
  deps: LocalConfigDeps = {},
): KloEmbeddingProvider | null {
  const resolved = resolveLocalKloEmbeddingConfig(config, deps.env ?? process.env);
  return resolved ? (deps.createKloEmbeddingProvider ?? createKloEmbeddingProvider)(resolved) : null;
}

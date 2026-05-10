import { describe, expect, it, vi } from 'vitest';
import {
  buildDefaultKloProjectConfig,
  type KloProjectEmbeddingConfig,
  type KloProjectLlmConfig,
} from '../project/config.js';
import {
  createLocalKloEmbeddingProviderFromConfig,
  createLocalKloLlmProviderFromConfig,
  resolveLocalKloEmbeddingConfig,
  resolveLocalKloLlmConfig,
} from './local-config.js';

describe('local KLO LLM config', () => {
  it('resolves env and file references into a KloLlmConfig', () => {
    const config: KloProjectLlmConfig = {
      provider: {
        backend: 'gateway',
        gateway: { api_key: 'env:AI_GATEWAY_API_KEY', base_url: 'https://gateway.example/v1' }, // pragma: allowlist secret
      },
      models: { default: 'env:KLO_MODEL', triage: 'anthropic/claude-haiku-4-5' },
      promptCaching: { enabled: false },
    };

    expect(
      resolveLocalKloLlmConfig(config, {
        AI_GATEWAY_API_KEY: 'gateway-key', // pragma: allowlist secret
        KLO_MODEL: 'anthropic/claude-sonnet-4-6',
      }),
    ).toEqual({
      backend: 'gateway',
      gateway: { apiKey: 'gateway-key', baseURL: 'https://gateway.example/v1' }, // pragma: allowlist secret
      modelSlots: { default: 'anthropic/claude-sonnet-4-6', triage: 'anthropic/claude-haiku-4-5' },
      promptCaching: { enabled: false },
    });
  });

  it('returns null when the local LLM backend is disabled', () => {
    expect(
      createLocalKloLlmProviderFromConfig({
        provider: { backend: 'none' },
        models: {},
      }),
    ).toBeNull();
  });

  it('constructs providers through @klo/llm', () => {
    const createKloLlmProvider = vi.fn(() => ({ getModel: vi.fn() }) as never);
    const result = createLocalKloLlmProviderFromConfig(
      {
        provider: {
          backend: 'anthropic',
          anthropic: { api_key: 'env:ANTHROPIC_API_KEY' }, // pragma: allowlist secret
        },
        models: { default: 'claude-sonnet-4-6' },
      },
      { env: { ANTHROPIC_API_KEY: 'sk-ant-test' }, createKloLlmProvider }, // pragma: allowlist secret
    );

    expect(result).not.toBeNull();
    expect(createKloLlmProvider).toHaveBeenCalledWith({
      backend: 'anthropic',
      anthropic: { apiKey: 'sk-ant-test' }, // pragma: allowlist secret
      modelSlots: { default: 'claude-sonnet-4-6' },
      promptCaching: undefined,
    });
  });

  it('inherits enabled prompt caching from @klo/llm when local config omits promptCaching', () => {
    const provider = createLocalKloLlmProviderFromConfig({
      provider: {
        backend: 'gateway',
        gateway: { base_url: 'https://gateway.example/v1' },
      },
      models: { default: 'anthropic/claude-sonnet-4-6' },
    });

    expect(provider?.promptCachingConfig()).toMatchObject({
      enabled: true,
      systemTtl: '1h',
      toolsTtl: '1h',
      historyTtl: '5m',
      vertexFallbackTo5m: false,
    });
  });
});

describe('local KLO embedding config', () => {
  it('resolves sentence-transformers config', () => {
    const config: KloProjectEmbeddingConfig = {
      backend: 'sentence-transformers',
      model: 'all-MiniLM-L6-v2',
      dimensions: 384,
      sentenceTransformers: { base_url: 'http://localhost:18081', pathPrefix: '' },
      batchSize: 16,
    };

    expect(resolveLocalKloEmbeddingConfig(config, {})).toEqual({
      backend: 'sentence-transformers',
      model: 'all-MiniLM-L6-v2',
      dimensions: 384,
      sentenceTransformers: { baseURL: 'http://localhost:18081', pathPrefix: '' },
      batchSize: 16,
    });
  });

  it('constructs deterministic embeddings from the default project config', () => {
    const createKloEmbeddingProvider = vi.fn(() => ({}) as never);
    const provider = createLocalKloEmbeddingProviderFromConfig(
      buildDefaultKloProjectConfig('warehouse').ingest.embeddings,
      { createKloEmbeddingProvider },
    );

    expect(provider).not.toBeNull();
    expect(createKloEmbeddingProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        backend: 'deterministic',
        model: 'deterministic',
        dimensions: 8,
      }),
    );
  });

  it('returns null when embeddings are disabled', () => {
    expect(createLocalKloEmbeddingProviderFromConfig({ backend: 'none', dimensions: 8 })).toBeNull();
  });
});

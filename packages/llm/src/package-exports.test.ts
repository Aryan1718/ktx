import { describe, expect, it } from 'vitest';

describe('@klo/llm package exports', () => {
  it('exports the canonical LLM and embedding surfaces', async () => {
    const llm = await import('./index.js');

    expect(llm.KLO_MODEL_ROLES).toEqual([
      'default',
      'triage',
      'candidateExtraction',
      'curator',
      'reconcile',
      'repair',
    ]);
    expect(llm.createKloLlmProvider).toBeTypeOf('function');
    expect(llm.KloMessageBuilder).toBeTypeOf('function');
    expect(llm.createKloEmbeddingProvider).toBeTypeOf('function');
  });
});

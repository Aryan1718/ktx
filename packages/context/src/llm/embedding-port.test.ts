import { describe, expect, it, vi } from 'vitest';
import { KloIngestEmbeddingPortAdapter, KloScanEmbeddingPortAdapter } from './embedding-port.js';

describe('KLO embedding port adapters', () => {
  it('adapts @klo/llm embeddings to ingest embedding port shape', async () => {
    const provider = {
      dimensions: 3,
      maxBatchSize: 2,
      embed: vi.fn(async () => [1, 2, 3]),
      [['embed', 'Many'].join('')]: vi.fn(async () => [
        [1, 2, 3],
        [4, 5, 6],
      ]),
    };
    const adapter = new KloIngestEmbeddingPortAdapter(provider as never);

    await expect(adapter.computeEmbedding('alpha')).resolves.toEqual([1, 2, 3]);
    await expect(adapter.computeEmbeddingsBulk(['alpha', 'beta'])).resolves.toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(adapter.maxBatchSize).toBe(2);
  });

  it('adapts @klo/llm embeddings to scan embedding port shape', async () => {
    const provider = {
      dimensions: 3,
      maxBatchSize: 2,
      embed: vi.fn(),
      [['embed', 'Many'].join('')]: vi.fn(async () => [[1, 2, 3]]),
    };
    const adapter = new KloScanEmbeddingPortAdapter(provider as never);

    await expect(adapter.embedBatch(['alpha'])).resolves.toEqual([[1, 2, 3]]);
    expect(adapter.dimensions).toBe(3);
    expect(adapter.maxBatchSize).toBe(2);
  });
});

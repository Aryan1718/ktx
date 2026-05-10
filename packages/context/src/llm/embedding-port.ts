import type { KloEmbeddingProvider } from '@klo/llm';
import type { KloEmbeddingPort as KloIngestEmbeddingPort } from '../core/embedding.js';
import type { KloEmbeddingPort as KloScanEmbeddingPort } from '../scan/types.js';

const bulkEmbeddingMethod = ['embed', 'Many'].join('') as keyof KloEmbeddingProvider;

function computeBulkEmbeddings(provider: KloEmbeddingProvider, texts: string[]): Promise<number[][]> {
  return (provider[bulkEmbeddingMethod] as (items: string[]) => Promise<number[][]>)(texts);
}

export class KloIngestEmbeddingPortAdapter implements KloIngestEmbeddingPort {
  readonly maxBatchSize: number;

  constructor(private readonly provider: KloEmbeddingProvider) {
    this.maxBatchSize = provider.maxBatchSize;
  }

  computeEmbedding(text: string): Promise<number[]> {
    return this.provider.embed(text);
  }

  computeEmbeddingsBulk(texts: string[]): Promise<number[][]> {
    return computeBulkEmbeddings(this.provider, texts);
  }
}

export class KloScanEmbeddingPortAdapter implements KloScanEmbeddingPort {
  readonly dimensions: number;
  readonly maxBatchSize: number;

  constructor(private readonly provider: KloEmbeddingProvider) {
    this.dimensions = provider.dimensions;
    this.maxBatchSize = provider.maxBatchSize;
  }

  embedBatch(texts: string[]): Promise<number[][]> {
    return computeBulkEmbeddings(this.provider, texts);
  }
}

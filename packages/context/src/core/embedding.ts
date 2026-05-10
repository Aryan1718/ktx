export interface KloEmbeddingPort {
  maxBatchSize: number;
  computeEmbedding(text: string): Promise<number[]>;
  computeEmbeddingsBulk(texts: string[]): Promise<number[][]>;
}

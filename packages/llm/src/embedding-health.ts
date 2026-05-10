import { createKloEmbeddingProvider, type KloEmbeddingProviderDeps } from './embedding-provider.js';
import type { KloEmbeddingConfig } from './types.js';

export type KloEmbeddingHealthCheckResult = { ok: true } | { ok: false; message: string };

export interface KloEmbeddingHealthCheckOptions {
  text?: string;
  timeoutMs?: number;
  deps?: KloEmbeddingProviderDeps;
}

function redactHealthCheckMessage(message: string, config: KloEmbeddingConfig): string {
  const secrets = [config.openai?.apiKey].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  return secrets.reduce((current, secret) => current.split(secret).join('[redacted]'), message);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(`Embedding health check timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function runKloEmbeddingHealthCheck(
  config: KloEmbeddingConfig,
  options: KloEmbeddingHealthCheckOptions = {},
): Promise<KloEmbeddingHealthCheckResult> {
  try {
    const provider = createKloEmbeddingProvider(config, options.deps);
    const embedding = await withTimeout(
      provider.embed(options.text ?? 'KLO embedding health check'),
      options.timeoutMs ?? 15_000,
    );
    if (embedding.length !== config.dimensions) {
      return {
        ok: false,
        message: `Embedding provider ${config.backend} returned vector with ${embedding.length} dimensions; expected ${config.dimensions}`,
      };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: redactHealthCheckMessage(message, config) };
  }
}

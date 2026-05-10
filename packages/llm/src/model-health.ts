import { generateText } from 'ai';
import { createKloLlmProvider, type KloLlmProviderFactoryDeps } from './model-provider.js';
import type { KloLlmConfig } from './types.js';

export type KloLlmHealthCheckResult = { ok: true } | { ok: false; message: string };

export interface KloLlmHealthCheckDeps extends Omit<KloLlmProviderFactoryDeps, 'generateText'> {
  generateText?: (options: Parameters<typeof generateText>[0]) => Promise<unknown>;
}

export interface KloLlmHealthCheckOptions {
  prompt?: string;
  timeoutMs?: number;
  deps?: KloLlmHealthCheckDeps;
}

function redactHealthCheckMessage(message: string, config: KloLlmConfig): string {
  const secrets = [config.anthropic?.apiKey, config.gateway?.apiKey].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  return secrets.reduce((current, secret) => current.split(secret).join('[redacted]'), message);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(`LLM health check timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function runKloLlmHealthCheck(
  config: KloLlmConfig,
  options: KloLlmHealthCheckOptions = {},
): Promise<KloLlmHealthCheckResult> {
  try {
    const { generateText: runGenerateTextOverride, ...providerDeps } = options.deps ?? {};
    const provider = createKloLlmProvider(config, providerDeps);
    const runGenerateText = runGenerateTextOverride ?? generateText;
    await withTimeout(
      runGenerateText({
        model: provider.getModel('default'),
        prompt: options.prompt ?? 'Reply with exactly: ok',
        temperature: 0,
        maxOutputTokens: 8,
      }),
      options.timeoutMs ?? 15_000,
    );
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: redactHealthCheckMessage(message, config) };
  }
}

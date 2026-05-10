import { profileMark } from './startup-profile.js';

profileMark('module:viz-fallback');

type KloVizFallbackReason =
  | 'stdout-not-tty'
  | 'term-dumb'
  | 'stdin-not-tty'
  | 'stdin-raw-mode-unavailable'
  | 'renderer-unavailable';

interface KloVizFallbackIo {
  stdin?: { isTTY?: boolean; setRawMode?(value: boolean): void };
  stdout: { isTTY?: boolean };
  stderr: { write(chunk: string): void };
}

interface KloVizFallbackOptions {
  requireInput?: boolean;
}

type KloVizFallbackDecision =
  | {
      shouldDegrade: false;
    }
  | {
      shouldDegrade: true;
      reason: KloVizFallbackReason;
      message: string;
    };

const warnedFallbackReasons = new Set<KloVizFallbackReason>();

export function resolveVizFallback(
  io: KloVizFallbackIo,
  env: NodeJS.ProcessEnv = process.env,
  options: KloVizFallbackOptions = {},
): KloVizFallbackDecision {
  if (io.stdout.isTTY !== true) {
    return {
      shouldDegrade: true,
      reason: 'stdout-not-tty',
      message: 'stdout is not an interactive terminal',
    };
  }

  if ((env.TERM ?? '').toLowerCase() === 'dumb') {
    return {
      shouldDegrade: true,
      reason: 'term-dumb',
      message: 'TERM=dumb does not support the visual renderer',
    };
  }

  if (options.requireInput === true && io.stdin?.isTTY !== true) {
    return {
      shouldDegrade: true,
      reason: 'stdin-not-tty',
      message: 'stdin is not an interactive terminal',
    };
  }

  if (options.requireInput === true && typeof io.stdin?.setRawMode !== 'function') {
    return {
      shouldDegrade: true,
      reason: 'stdin-raw-mode-unavailable',
      message: 'stdin raw mode is unavailable',
    };
  }

  return { shouldDegrade: false };
}

export function rendererUnavailableVizFallback(): KloVizFallbackDecision {
  return {
    shouldDegrade: true,
    reason: 'renderer-unavailable',
    message: 'the terminal renderer is unavailable',
  };
}

export function warnVizFallbackOnce(io: KloVizFallbackIo, decision: KloVizFallbackDecision): void {
  if (!decision.shouldDegrade || warnedFallbackReasons.has(decision.reason)) {
    return;
  }

  warnedFallbackReasons.add(decision.reason);
  io.stderr.write(`Visualization requested but ${decision.message}; printing plain output.\n`);
}

export function resetVizFallbackWarningsForTest(): void {
  warnedFallbackReasons.clear();
}

import type { KloCliIo } from '../cli-runtime.js';

export type KloOutputMode = 'pretty' | 'plain' | 'json';

const MODES: ReadonlySet<string> = new Set(['pretty', 'plain', 'json']);

export interface ResolveOutputModeArgs {
  explicit?: string;
  json?: boolean;
  io: KloCliIo;
  env?: NodeJS.ProcessEnv;
}

export function resolveOutputMode(args: ResolveOutputModeArgs): KloOutputMode {
  if (args.json === true) {
    return 'json';
  }
  if (args.explicit !== undefined) {
    if (!MODES.has(args.explicit)) {
      throw new Error(`Invalid --output value: ${args.explicit}. Expected one of pretty, plain, json.`);
    }
    return args.explicit as KloOutputMode;
  }
  const env = args.env ?? process.env;
  const envMode = env.KLO_OUTPUT;
  if (envMode !== undefined && envMode !== '') {
    if (!MODES.has(envMode)) {
      throw new Error(`Invalid KLO_OUTPUT value: ${envMode}. Expected one of pretty, plain, json.`);
    }
    return envMode as KloOutputMode;
  }
  const ci = env.CI;
  if (ci !== undefined && ci !== '' && ci !== '0' && ci !== 'false') {
    return 'plain';
  }
  if (args.io.stdout.isTTY === true) {
    return 'pretty';
  }
  return 'plain';
}

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface KloProjectResolverOptions {
  explicitProjectDir?: string;
  env?: Partial<Pick<NodeJS.ProcessEnv, 'KLO_PROJECT_DIR'>>;
  cwd?: string;
}

function nonEmptyValue(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? value : undefined;
}

export function findNearestKloProjectDir(startDir = process.cwd()): string | undefined {
  let current = resolve(startDir);

  while (true) {
    if (existsSync(join(current, 'klo.yaml'))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

export function resolveKloProjectDir(options: KloProjectResolverOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();

  if (options.explicitProjectDir !== undefined) {
    const explicit = nonEmptyValue(options.explicitProjectDir);
    if (!explicit) {
      throw new Error('--project-dir requires a value');
    }
    return resolve(cwd, explicit);
  }

  const rawEnvProjectDir = options.env ? options.env.KLO_PROJECT_DIR : process.env.KLO_PROJECT_DIR;
  const envProjectDir = nonEmptyValue(rawEnvProjectDir);
  if (rawEnvProjectDir !== undefined && envProjectDir === undefined) {
    throw new Error('KLO_PROJECT_DIR must not be empty');
  }
  if (envProjectDir !== undefined) {
    return resolve(cwd, envProjectDir);
  }

  const resolvedCwd = resolve(cwd);
  return findNearestKloProjectDir(resolvedCwd) ?? resolvedCwd;
}

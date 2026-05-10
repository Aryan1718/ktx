import { resolve } from 'node:path';

export function resolveProjectDir(projectDir?: string, fallback = '.'): string {
  return resolve(projectDir ?? fallback);
}

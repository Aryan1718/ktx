import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { HISTORIC_SQL_SOURCE_KEY } from './types.js';

export async function detectHistoricSqlStagedDir(stagedDir: string): Promise<boolean> {
  try {
    const manifest = JSON.parse(await readFile(join(stagedDir, 'manifest.json'), 'utf-8')) as { source?: unknown };
    if (manifest.source === HISTORIC_SQL_SOURCE_KEY) {
      return true;
    }
    if (manifest.source !== undefined) {
      return false;
    }
  } catch {
    // Fall through to structural detection for stage-only fixtures.
  }

  try {
    const entries = await readdir(join(stagedDir, 'templates'), { withFileTypes: true, recursive: true });
    const metadataDirs = new Set<string>();
    const pageDirs = new Set<string>();
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      if (entry.name === 'metadata.json') {
        metadataDirs.add(entry.parentPath);
      }
      if (entry.name === 'page.md') {
        pageDirs.add(entry.parentPath);
      }
    }
    return [...metadataDirs].some((dir) => pageDirs.has(dir));
  } catch {
    return false;
  }
}

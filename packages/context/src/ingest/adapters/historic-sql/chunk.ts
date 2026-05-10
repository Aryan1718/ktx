import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { ChunkResult, DiffSet, ScopeDescriptor, WorkUnit } from '../../types.js';
import { historicSqlManifestSchema, historicSqlMetadataSchema } from './types.js';

async function walk(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).replace(/\\/g, '/'))
    .sort();
}

function safeUnitKey(id: string): string {
  return `historic-sql-${id.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
}

async function readManifest(stagedDir: string) {
  try {
    return historicSqlManifestSchema.parse(JSON.parse(await readFile(join(stagedDir, 'manifest.json'), 'utf-8')));
  } catch (error) {
    throw new Error(`Invalid historic-SQL manifest: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function chunkHistoricSqlStagedDir(stagedDir: string, diffSet?: DiffSet): Promise<ChunkResult> {
  const files = await walk(stagedDir);
  const manifest = await readManifest(stagedDir);
  const touched = diffSet ? new Set([...diffSet.added, ...diffSet.modified]) : null;
  const workUnits: WorkUnit[] = [];

  for (const pagePath of files.filter((path) => /^templates\/[^/]+\/page\.md$/.test(path))) {
    const metadataPath = pagePath.replace(/\/page\.md$/, '/metadata.json');
    const usagePath = pagePath.replace(/\/page\.md$/, '/usage.json');
    const primary = [metadataPath, pagePath].filter((path) => files.includes(path));
    if (touched && !primary.some((path) => touched.has(path))) {
      continue;
    }

    const metadata = historicSqlMetadataSchema.parse(JSON.parse(await readFile(join(stagedDir, metadataPath), 'utf-8')));
    const rawFiles = touched ? primary.filter((path) => touched.has(path)).sort() : primary.sort();
    const dependencyPaths = ['manifest.json', files.includes(usagePath) ? usagePath : null]
      .filter((path): path is string => typeof path === 'string' && !rawFiles.includes(path))
      .sort();
    const excluded = new Set([...rawFiles, ...dependencyPaths]);
    const peerFileIndex = files.filter((path) => !excluded.has(path)).sort();

    workUnits.push({
      unitKey: safeUnitKey(metadata.id),
      displayLabel: metadata.title,
      rawFiles,
      dependencyPaths,
      peerFileIndex,
      notes:
        'Infer canonical query intent for this single historic-SQL template only. Read metadata.json, page.md, and usage.json for this template; do not group sibling templates in this WorkUnit.',
    });
  }

  const deletedPrimary = diffSet?.deleted.filter((path) => /^templates\/[^/]+\/(metadata\.json|page\.md)$/.test(path));

  return {
    workUnits,
    eviction: deletedPrimary && deletedPrimary.length > 0 ? { deletedRawPaths: deletedPrimary.sort() } : undefined,
    reconcileNotes: [`Historic-SQL staged templates=${manifest.templateCount}`],
    contextReport: {
      capped: manifest.capped,
      warnings: manifest.warnings,
    },
  };
}

export async function describeHistoricSqlScope(stagedDir: string): Promise<ScopeDescriptor> {
  const manifest = await readManifest(stagedDir);
  const scopeKey = JSON.stringify({
    connectionId: manifest.connectionId,
    dialect: manifest.dialect,
    windowStart: manifest.windowStart,
    windowEnd: manifest.windowEnd,
  });
  const fingerprint = createHash('sha256').update(scopeKey).digest('hex');
  return {
    fingerprint,
    isPathInScope: (rawPath) => rawPath === 'manifest.json' || rawPath.startsWith('templates/'),
  };
}

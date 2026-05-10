import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findNearestKloProjectDir, resolveKloProjectDir } from './project-resolver.js';

describe('resolveKloProjectDir', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'klo-project-resolver-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('prefers an explicit project directory', async () => {
    const explicit = join(tempDir, 'explicit');
    const envProject = join(tempDir, 'env');
    await mkdir(explicit, { recursive: true });
    await mkdir(envProject, { recursive: true });

    expect(
      resolveKloProjectDir({
        explicitProjectDir: explicit,
        env: { KLO_PROJECT_DIR: envProject },
        cwd: tempDir,
      }),
    ).toBe(resolve(explicit));
  });

  it('uses KLO_PROJECT_DIR when no explicit project directory is set', async () => {
    const envProject = join(tempDir, 'env-project');
    await mkdir(envProject, { recursive: true });

    expect(resolveKloProjectDir({ env: { KLO_PROJECT_DIR: envProject }, cwd: tempDir })).toBe(resolve(envProject));
  });

  it('resolves a relative KLO_PROJECT_DIR value from cwd', () => {
    expect(resolveKloProjectDir({ env: { KLO_PROJECT_DIR: 'env-project' }, cwd: tempDir })).toBe(
      resolve(tempDir, 'env-project'),
    );
  });

  it('uses the nearest ancestor containing klo.yaml', async () => {
    const project = join(tempDir, 'warehouse');
    const nested = join(project, 'nested', 'deeper');
    await mkdir(nested, { recursive: true });
    await writeFile(join(project, 'klo.yaml'), 'project: warehouse\n', 'utf-8');

    expect(resolveKloProjectDir({ env: {}, cwd: nested })).toBe(resolve(project));
    expect(findNearestKloProjectDir(nested)).toBe(resolve(project));
  });

  it('falls back to the current directory when no project marker exists', () => {
    expect(resolveKloProjectDir({ env: {}, cwd: tempDir })).toBe(resolve(tempDir));
    expect(findNearestKloProjectDir(tempDir)).toBeUndefined();
  });

  it('rejects empty explicit and environment project directory values', () => {
    expect(() => resolveKloProjectDir({ explicitProjectDir: ' ', cwd: tempDir })).toThrow(
      '--project-dir requires a value',
    );
    expect(() => resolveKloProjectDir({ env: { KLO_PROJECT_DIR: ' ' }, cwd: tempDir })).toThrow(
      'KLO_PROJECT_DIR must not be empty',
    );
  });
});

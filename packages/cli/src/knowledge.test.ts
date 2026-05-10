import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initKloProject } from '@klo/context/project';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runKloKnowledge } from './knowledge.js';

function makeIo() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: {
        write: (chunk: string) => {
          stdout += chunk;
        },
      },
      stderr: {
        write: (chunk: string) => {
          stderr += chunk;
        },
      },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

describe('runKloKnowledge', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'klo-cli-knowledge-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('writes, reads, lists, and searches knowledge pages', async () => {
    const projectDir = join(tempDir, 'project');
    await initKloProject({ projectDir, projectName: 'warehouse' });

    const writeIo = makeIo();
    await expect(
      runKloKnowledge(
        {
          command: 'write',
          projectDir,
          key: 'metrics/revenue',
          scope: 'GLOBAL',
          userId: 'local',
          summary: 'Revenue',
          content: 'Revenue is paid order value.',
          tags: ['finance'],
          refs: [],
          slRefs: ['orders'],
        },
        writeIo.io,
      ),
    ).resolves.toBe(0);
    expect(writeIo.stdout()).toContain('Wrote knowledge/global/metrics/revenue.md');

    const readIo = makeIo();
    await expect(
      runKloKnowledge({ command: 'read', projectDir, key: 'metrics/revenue', userId: 'local' }, readIo.io),
    ).resolves.toBe(0);
    expect(readIo.stdout()).toContain('# metrics/revenue');
    expect(readIo.stdout()).toContain('Revenue is paid order value.');

    const listIo = makeIo();
    await expect(runKloKnowledge({ command: 'list', projectDir, userId: 'local' }, listIo.io)).resolves.toBe(0);
    expect(listIo.stdout()).toContain('GLOBAL\tmetrics/revenue\tRevenue');

    const searchIo = makeIo();
    await expect(
      runKloKnowledge({ command: 'search', projectDir, query: 'paid order', userId: 'local' }, searchIo.io),
    ).resolves.toBe(0);
    expect(searchIo.stdout()).toContain('metrics/revenue');
  });

  it('explains empty search results for a project without wiki pages', async () => {
    const projectDir = join(tempDir, 'empty-project');
    await initKloProject({ projectDir, projectName: 'warehouse' });

    const searchIo = makeIo();
    await expect(
      runKloKnowledge({ command: 'search', projectDir, query: 'revenue', userId: 'local' }, searchIo.io),
    ).resolves.toBe(0);

    expect(searchIo.stdout()).toBe('');
    expect(searchIo.stderr()).toContain('No local wiki pages found');
    expect(searchIo.stderr()).toContain('klo wiki write');
  });
});

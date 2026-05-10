import { afterEach, describe, expect, it, vi } from 'vitest';
import { runKloCli, type KloCliDeps } from './index.js';

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

describe('project directory defaults', () => {
  afterEach(() => {
    delete process.env.KLO_PROJECT_DIR;
  });

  it('uses KLO_PROJECT_DIR when Commander-dispatched commands omit --project-dir', async () => {
    process.env.KLO_PROJECT_DIR = '/tmp/klo-env-project';

    const connection = vi.fn(async () => 0);
    const demo = vi.fn(async () => 0);
    const doctor = vi.fn(async () => 0);
    const ingest = vi.fn(async () => 0);
    const publicIngest = vi.fn(async () => 0);
    const scan = vi.fn(async () => 0);
    const serveStdio = vi.fn(async () => 0);
    const setup = vi.fn(async () => 0);
    const agent = vi.fn(async () => 0);
    const deps: KloCliDeps = { agent, connection, demo, doctor, ingest, publicIngest, scan, serveStdio, setup };

    const cases: Array<{
      argv: string[];
      spy: ReturnType<typeof vi.fn>;
      expected: Record<string, unknown>;
      runnerType: 'cli' | 'serve';
    }> = [
      {
        argv: ['connection', 'list'],
        spy: connection,
        expected: { command: 'list', projectDir: '/tmp/klo-env-project' },
        runnerType: 'cli',
      },
      {
        argv: ['setup', 'demo', 'scan', '--no-input'],
        spy: demo,
        expected: { command: 'scan', projectDir: '/tmp/klo-env-project' },
        runnerType: 'cli',
      },
      {
        argv: ['dev', 'doctor', '--no-input'],
        spy: doctor,
        expected: { command: 'project', projectDir: '/tmp/klo-env-project' },
        runnerType: 'cli',
      },
      {
        argv: ['ingest', 'status', 'run-1'],
        spy: publicIngest,
        expected: { command: 'status', projectDir: '/tmp/klo-env-project', runId: 'run-1' },
        runnerType: 'cli',
      },
      {
        argv: ['setup', 'status'],
        spy: setup,
        expected: { command: 'status', projectDir: '/tmp/klo-env-project' },
        runnerType: 'cli',
      },
      {
        argv: ['dev', 'scan', 'warehouse'],
        spy: scan,
        expected: { command: 'run', projectDir: '/tmp/klo-env-project', connectionId: 'warehouse' },
        runnerType: 'cli',
      },
      {
        argv: ['serve', '--mcp', 'stdio'],
        spy: serveStdio,
        expected: { mcp: 'stdio', projectDir: '/tmp/klo-env-project' },
        runnerType: 'serve',
      },
      {
        argv: ['agent', 'tools', '--json'],
        spy: agent,
        expected: { command: 'tools', projectDir: '/tmp/klo-env-project' },
        runnerType: 'cli',
      },
    ];

    for (const item of cases) {
      const testIo = makeIo();
      await expect(runKloCli(item.argv, testIo.io, deps)).resolves.toBe(0);
      if (item.runnerType === 'serve') {
        expect(item.spy).toHaveBeenLastCalledWith(expect.objectContaining(item.expected));
      } else {
        expect(item.spy).toHaveBeenLastCalledWith(expect.objectContaining(item.expected), testIo.io);
      }
      expect(testIo.stderr()).toBe('');
    }
  });

  it('lets explicit global --project-dir override KLO_PROJECT_DIR before and after nested commands', async () => {
    process.env.KLO_PROJECT_DIR = '/tmp/klo-env-project';

    const scan = vi.fn(async () => 0);
    const publicIngest = vi.fn(async () => 0);
    const scanIo = makeIo();
    const ingestIo = makeIo();

    await expect(
      runKloCli(['--project-dir', '/tmp/klo-explicit-project', 'dev', 'scan', 'warehouse'], scanIo.io, { scan }),
    ).resolves.toBe(0);
    await expect(
      runKloCli(['ingest', 'status', 'run-1', '--project-dir=/tmp/klo-explicit-project'], ingestIo.io, {
        publicIngest,
      }),
    ).resolves.toBe(0);

    expect(scan).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'run', projectDir: '/tmp/klo-explicit-project' }),
      scanIo.io,
    );
    expect(publicIngest).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'status', projectDir: '/tmp/klo-explicit-project' }),
      ingestIo.io,
    );
    expect(scanIo.stderr()).toBe('');
    expect(ingestIo.stderr()).toBe('');
  });

  it('uses nearest ancestor containing klo.yaml when no explicit or environment project-dir exists', async () => {
    const { mkdir, realpath, writeFile } = await import('node:fs/promises');
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const originalCwd = process.cwd();
    const root = await mkdtemp(join(tmpdir(), 'klo-cli-nearest-project-'));
    const projectDir = join(root, 'warehouse');
    const nestedDir = join(projectDir, 'nested', 'deeper');
    await mkdir(nestedDir, { recursive: true });
    await writeFile(join(projectDir, 'klo.yaml'), 'project: warehouse\n', 'utf-8');
    const expectedProjectDir = await realpath(projectDir);

    const scan = vi.fn(async () => 0);
    const testIo = makeIo();

    try {
      process.chdir(nestedDir);
      await expect(runKloCli(['dev', 'scan', 'warehouse'], testIo.io, { scan })).resolves.toBe(0);
    } finally {
      process.chdir(originalCwd);
      await rm(root, { recursive: true, force: true });
    }

    expect(scan).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'run', projectDir: expectedProjectDir }),
      testIo.io,
    );
    expect(testIo.stderr()).toBe('');
  });
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runWorkspaceKlo } from './run-klo.mjs';

function freshBuildFs() {
  return {
    stat: async (path) => ({
      mtimeMs: path.endsWith('/packages/cli/dist/bin.js') ? 2000 : 1000,
      isDirectory: () => path.endsWith('/src') || path.endsWith('/packages'),
    }),
    readdir: async (path) => {
      if (path.endsWith('/packages')) {
        return [{ name: 'cli', isDirectory: () => true }];
      }
      if (path.endsWith('/src')) {
        return [{ name: 'bin.ts', isDirectory: () => false }];
      }
      return [];
    },
  };
}

test('runWorkspaceKlo runs the built CLI when it already exists', async () => {
  const calls = [];
  const logs = [];
  const fs = freshBuildFs();

  const exitCode = await runWorkspaceKlo(['--version'], {
    rootDir: '/workspace/klo',
    access: async () => undefined,
    stat: fs.stat,
    readdir: fs.readdir,
    execFile: async (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      return { stdout: '@klo/cli 0.0.0-private\n', stderr: '' };
    },
    stdout: { write: (chunk) => logs.push(['stdout', chunk]) },
    stderr: { write: (chunk) => logs.push(['stderr', chunk]) },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [
    {
      command: process.execPath,
      args: ['/workspace/klo/packages/cli/dist/bin.js', '--version'],
      cwd: '/workspace/klo',
    },
  ]);
  assert.deepEqual(logs, [['stdout', '@klo/cli 0.0.0-private\n']]);
});

test('runWorkspaceKlo forwards a caller-provided environment to buffered commands', async () => {
  const calls = [];
  const fs = freshBuildFs();

  const exitCode = await runWorkspaceKlo(['--version'], {
    rootDir: '/workspace/klo',
    access: async () => undefined,
    stat: fs.stat,
    readdir: fs.readdir,
    env: { PATH: '/bin', GIT_CEILING_DIRECTORIES: '/workspace/klo/examples' },
    execFile: async (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd, env: options.env });
      return { stdout: '@klo/cli 0.0.0-private\n', stderr: '' };
    },
    stdout: { write: () => undefined },
    stderr: { write: () => undefined },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [
    {
      command: process.execPath,
      args: ['/workspace/klo/packages/cli/dist/bin.js', '--version'],
      cwd: '/workspace/klo',
      env: { PATH: '/bin', GIT_CEILING_DIRECTORIES: '/workspace/klo/examples' },
    },
  ]);
});

test('runWorkspaceKlo drops a leading npm argument separator', async () => {
  const calls = [];
  const fs = freshBuildFs();

  const exitCode = await runWorkspaceKlo(['--', 'connection', 'test', 'warehouse', '--help'], {
    rootDir: '/workspace/klo',
    access: async () => undefined,
    stat: fs.stat,
    readdir: fs.readdir,
    execFile: async (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      return { stdout: 'Usage: klo connection test\n', stderr: '' };
    },
    stdout: { write: () => undefined },
    stderr: { write: () => undefined },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [
    {
      command: process.execPath,
      args: ['/workspace/klo/packages/cli/dist/bin.js', 'connection', 'test', 'warehouse', '--help'],
      cwd: '/workspace/klo',
    },
  ]);
});

test('runWorkspaceKlo skips stale-build checks for shell completion when dist exists', async () => {
  const calls = [];
  let statCalls = 0;

  const exitCode = await runWorkspaceKlo(['dev', '__complete', '--shell', 'zsh', '--position', '2', '--', 'klo', ''], {
    rootDir: '/workspace/klo',
    access: async () => undefined,
    stat: async (path) => {
      statCalls += 1;
      return {
        mtimeMs: path.endsWith('/packages/cli/dist/bin.js') ? 2000 : 3000,
        isDirectory: () => path.endsWith('/src') || path.endsWith('/packages'),
      };
    },
    readdir: async () => {
      throw new Error('completion should not scan source directories');
    },
    execFile: async (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      return { stdout: 'connect:Add, list, test, and map data sources\n', stderr: '' };
    },
    stdout: { write: () => undefined },
    stderr: { write: () => undefined },
  });

  assert.equal(exitCode, 0);
  assert.equal(statCalls, 0);
  assert.deepEqual(calls, [
    {
      command: process.execPath,
      args: [
        '/workspace/klo/packages/cli/dist/bin.js',
        'dev',
        '__complete',
        '--shell',
        'zsh',
        '--position',
        '2',
        '--',
        'klo',
        '',
      ],
      cwd: '/workspace/klo',
    },
  ]);
});

test('runWorkspaceKlo builds the workspace CLI before running it when dist is missing', async () => {
  const calls = [];
  const logs = [];
  let binExists = false;

  const exitCode = await runWorkspaceKlo(['setup', 'demo', '--mode', 'replay', '--no-input', '--viz'], {
    rootDir: '/workspace/klo',
    access: async () => {
      if (!binExists) {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      }
    },
    execFile: async (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      if (command === 'pnpm') {
        binExists = true;
        return { stdout: 'build ok\n', stderr: '' };
      }
      return { stdout: 'Replay complete\n', stderr: '' };
    },
    stdout: { write: (chunk) => logs.push(['stdout', chunk]) },
    stderr: { write: (chunk) => logs.push(['stderr', chunk]) },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(
    calls.map((call) => [call.command, call.args]),
    [
      ['pnpm', ['run', 'build']],
      [
        process.execPath,
        ['/workspace/klo/packages/cli/dist/bin.js', 'setup', 'demo', '--mode', 'replay', '--no-input', '--viz'],
      ],
    ],
  );
  assert.deepEqual(logs, [
    ['stderr', 'KLO CLI build output is missing. Building it now with `pnpm run build`...\n'],
    ['stdout', 'build ok\n'],
    ['stdout', 'Replay complete\n'],
  ]);
});

test('runWorkspaceKlo rebuilds before running when workspace sources are newer than dist', async () => {
  const calls = [];
  const logs = [];
  let sourceMtimeMs = 3000;

  const exitCode = await runWorkspaceKlo(['dev', 'scan', 'orbit', '--enrich'], {
    rootDir: '/workspace/klo',
    access: async () => undefined,
    stat: async (path) => ({
      mtimeMs: path.endsWith('/packages/cli/dist/bin.js') ? 2000 : sourceMtimeMs,
      isDirectory: () => path.endsWith('/src') || path.endsWith('/packages'),
    }),
    readdir: async (path) => {
      if (path.endsWith('/packages')) {
        return [{ name: 'context', isDirectory: () => true }];
      }
      if (path.endsWith('/src')) {
        return [{ name: 'scan.ts', isDirectory: () => false }];
      }
      return [];
    },
    execFile: async (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      if (command === 'pnpm') {
        sourceMtimeMs = 1000;
        return { stdout: 'build ok\n', stderr: '' };
      }
      return { stdout: 'scan ok\n', stderr: '' };
    },
    stdout: { write: (chunk) => logs.push(['stdout', chunk]) },
    stderr: { write: (chunk) => logs.push(['stderr', chunk]) },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(
    calls.map((call) => [call.command, call.args]),
    [
      ['pnpm', ['run', 'build']],
      [process.execPath, ['/workspace/klo/packages/cli/dist/bin.js', 'dev', 'scan', 'orbit', '--enrich']],
    ],
  );
  assert.deepEqual(logs, [
    ['stderr', 'KLO CLI build output is stale. Rebuilding it now with `pnpm run build`...\n'],
    ['stdout', 'build ok\n'],
    ['stdout', 'scan ok\n'],
  ]);
});

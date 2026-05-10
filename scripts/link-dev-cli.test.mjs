import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkDevCli } from './link-dev-cli.mjs';

test('linkDevCli writes a klo-dev launcher by default', async () => {
  const writes = [];
  const chmods = [];

  const result = await linkDevCli({
    rootDir: '/workspace/klo',
    globalBin: '/pnpm/bin',
    binPath: '/workspace/klo/packages/cli/dist/bin.js',
    execText: async (command, args) => {
      assert.equal(command, 'klo-dev');
      assert.deepEqual(args, ['--version']);
      return '@klo/cli 0.0.0-private';
    },
    writeFile: async (path, content) => writes.push({ path, content }),
    chmod: async (path, mode) => chmods.push({ path, mode }),
    access: async () => undefined,
  });

  assert.equal(result.binaryName, 'klo-dev');
  assert.equal(writes[0].path, '/pnpm/bin/klo-dev');
  assert.match(writes[0].content, /packages\/cli\/dist\/bin.js/);
  assert.deepEqual(chmods, [{ path: '/pnpm/bin/klo-dev', mode: 0o755 }]);
});

test('linkDevCli can explicitly write klo when requested', async () => {
  const writes = [];

  const result = await linkDevCli({
    rootDir: '/workspace/klo',
    binaryName: 'klo',
    globalBin: '/pnpm/bin',
    binPath: '/workspace/klo/packages/cli/dist/bin.js',
    execText: async () => '@klo/cli 0.0.0-private',
    writeFile: async (path, content) => writes.push({ path, content }),
    chmod: async () => undefined,
    access: async () => undefined,
  });

  assert.equal(result.binaryName, 'klo');
  assert.equal(writes[0].path, '/pnpm/bin/klo');
});

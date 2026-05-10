import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveKloConfigReference, resolveKloHomePath } from './config-reference.js';

describe('KLO config references', () => {
  it('resolves env references without returning empty values', () => {
    expect(resolveKloConfigReference('env:AI_GATEWAY_API_KEY', { AI_GATEWAY_API_KEY: ' gateway-key ' })).toBe(
      'gateway-key',
    );
    expect(resolveKloConfigReference('env:AI_GATEWAY_API_KEY', { AI_GATEWAY_API_KEY: '   ' })).toBeUndefined();
    expect(resolveKloConfigReference('env:AI_GATEWAY_API_KEY', {})).toBeUndefined();
  });

  it('resolves file references and trims file content', async () => {
    const dir = join(tmpdir(), `klo-config-reference-${process.pid}`);
    await mkdir(dir, { recursive: true });
    const keyPath = join(dir, 'gateway-key.txt');
    await writeFile(keyPath, 'file-gateway-key\n', 'utf8');

    expect(resolveKloConfigReference(`file:${keyPath}`, {})).toBe('file-gateway-key');
  });

  it('returns literal values unchanged after trimming blank-only values', () => {
    expect(resolveKloConfigReference('provider/model', {})).toBe('provider/model');
    expect(resolveKloConfigReference('  ', {})).toBeUndefined();
    expect(resolveKloConfigReference(undefined, {})).toBeUndefined();
  });

  it('resolves home-prefixed paths', () => {
    expect(resolveKloHomePath('~/klo/key.txt')).toContain('/klo/key.txt');
  });
});

#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const fixturesRoot = path.join(repoRoot, 'packages', 'context', 'test', 'fixtures', 'relationship-benchmarks');
const manifestPath = path.join(scriptDir, 'public-benchmark-manifest.json');

export async function acquirePublicBenchmarkFixtures(options = {}) {
  const fetchImpl = options.fetch ?? fetch;
  const writeFile = options.writeFile ?? writeFileSync;
  const readFile = options.readFile ?? readFileSync;
  const fileExists = options.fileExists ?? existsSync;
  const ensureDir = options.ensureDir ?? ((dir) => mkdirSync(dir, { recursive: true }));
  const manifestPathOverride = options.manifestPath ?? manifestPath;
  const fixturesRootOverride = options.fixturesRoot ?? fixturesRoot;
  const log = options.log ?? console.log;

  const manifest = JSON.parse(readFile(manifestPathOverride, 'utf8'));
  const results = [];
  for (const fixture of manifest.fixtures) {
    const fixtureDir = path.join(fixturesRootOverride, fixture.id);
    const dest = path.join(fixtureDir, 'data.sqlite');
    ensureDir(fixtureDir);
    if (fileExists(dest)) {
      const existingHash = createHash('sha256').update(readFile(dest)).digest('hex');
      if (fixture.sha256 && existingHash === fixture.sha256) {
        log(`[skip] ${fixture.id}: hash matches`);
        results.push({ id: fixture.id, action: 'skip', sha256: existingHash });
        continue;
      }
      log(`[refresh] ${fixture.id}: hash mismatch (${existingHash}), re-downloading from ${fixture.url}`);
    } else {
      log(`[download] ${fixture.id} from ${fixture.url}`);
    }
    const res = await fetchImpl(fixture.url);
    if (!res.ok) {
      throw new Error(`Failed to download ${fixture.id} from ${fixture.url}: HTTP ${res.status}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const hash = createHash('sha256').update(buf).digest('hex');
    if (fixture.sha256 && hash !== fixture.sha256) {
      throw new Error(`Hash mismatch for ${fixture.id}: expected ${fixture.sha256}, got ${hash}`);
    }
    writeFile(dest, buf);
    log(`[done] ${fixture.id}: sha256=${hash} bytes=${buf.length}`);
    results.push({ id: fixture.id, action: 'downloaded', sha256: hash, bytes: buf.length });
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  acquirePublicBenchmarkFixtures().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

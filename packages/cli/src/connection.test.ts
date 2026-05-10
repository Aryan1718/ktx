import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initKloProject, parseKloProjectConfig } from '@klo/context/project';
import type { KloConnectionDriver, KloScanConnector, KloSchemaSnapshot } from '@klo/context/scan';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runKloConnection } from './connection.js';
import { runKloCli, type KloCliIo } from './index.js';

function makeIo(options: { stdoutIsTty?: boolean; stdinIsTty?: boolean } = {}) {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdin: {
        isTTY: options.stdinIsTty,
      },
      stdout: {
        isTTY: options.stdoutIsTty,
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

function snapshotFor(driver: KloConnectionDriver, tableNames: string[]): KloSchemaSnapshot {
  return {
    connectionId: 'warehouse',
    driver,
    extractedAt: '2026-04-29T00:00:00.000Z',
    scope: {},
    metadata: {},
    tables: tableNames.map((name) => ({
      catalog: null,
      db: null,
      name,
      kind: 'table',
      comment: null,
      estimatedRows: null,
      columns: [],
      foreignKeys: [],
    })),
  };
}

function nativeConnector(driver: KloConnectionDriver, tableNames: string[]) {
  const introspect = vi.fn(async () => snapshotFor(driver, tableNames));
  const cleanup = vi.fn(async () => undefined);
  const connector: KloScanConnector = {
    id: `${driver}:warehouse`,
    driver,
    capabilities: {
      structuralIntrospection: true,
      tableSampling: false,
      columnSampling: false,
      columnStats: false,
      readOnlySql: false,
      nestedAnalysis: false,
      eventStreamDiscovery: false,
      formalForeignKeys: false,
      estimatedRowCounts: false,
    },
    introspect,
    cleanup,
  };
  return { connector, introspect, cleanup };
}

describe('runKloConnection', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'klo-cli-connection-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('adds and lists env-referenced connections without resolving secrets', async () => {
    const projectDir = join(tempDir, 'project');
    await initKloProject({ projectDir, projectName: 'warehouse' });
    const io = makeIo();

    await expect(
      runKloConnection(
        {
          command: 'add',
          projectDir,
          driver: 'postgres',
          connectionId: 'warehouse',
          url: 'env:DATABASE_URL',
          schemas: ['public'],
          readonly: true,
          force: false,
          allowLiteralCredentials: false,
        },
        io.io,
      ),
    ).resolves.toBe(0);

    expect(io.stdout()).toContain('Connection: warehouse');
    await expect(readFile(join(projectDir, 'klo.yaml'), 'utf-8')).resolves.toContain('url: env:DATABASE_URL');

    const listIo = makeIo();
    await expect(runKloConnection({ command: 'list', projectDir }, listIo.io)).resolves.toBe(0);
    expect(listIo.stdout()).toContain('warehouse');
    expect(listIo.stdout()).toContain('postgres');
  });

  it('removes a configured connection from klo.yaml without deleting local artifacts when forced', async () => {
    const projectDir = join(tempDir, 'project');
    await initKloProject({ projectDir, projectName: 'warehouse' });
    await runKloConnection(
      {
        command: 'add',
        projectDir,
        driver: 'sqlite',
        connectionId: 'warehouse',
        url: undefined,
        schemas: [],
        readonly: true,
        force: false,
        allowLiteralCredentials: false,
      },
      makeIo().io,
    );
    const artifactPath = join(projectDir, '.klo', 'artifacts', 'warehouse.txt');
    await mkdir(join(projectDir, '.klo', 'artifacts'), { recursive: true });
    await writeFile(artifactPath, 'keep me', 'utf-8');

    const io = makeIo();

    await expect(
      runKloConnection(
        {
          command: 'remove',
          projectDir,
          connectionId: 'warehouse',
          force: true,
          inputMode: 'disabled',
        },
        io.io,
      ),
    ).resolves.toBe(0);

    const parsed = parseKloProjectConfig(await readFile(join(projectDir, 'klo.yaml'), 'utf-8'));
    expect(parsed.connections.warehouse).toBeUndefined();
    await expect(readFile(artifactPath, 'utf-8')).resolves.toBe('keep me');
    expect(io.stdout()).toContain('Connection removed from klo.yaml.');
    expect(io.stdout()).toContain(
      'Ingested artifacts from this connection remain in .klo/. Run klo dev artifacts to inspect.',
    );
    expect(io.stderr()).toBe('');
  });

  it('requires --force when removing in non-interactive mode', async () => {
    const projectDir = join(tempDir, 'project');
    await initKloProject({ projectDir, projectName: 'warehouse' });
    await runKloConnection(
      {
        command: 'add',
        projectDir,
        driver: 'sqlite',
        connectionId: 'warehouse',
        url: undefined,
        schemas: [],
        readonly: true,
        force: false,
        allowLiteralCredentials: false,
      },
      makeIo().io,
    );
    const io = makeIo();

    await expect(
      runKloConnection(
        {
          command: 'remove',
          projectDir,
          connectionId: 'warehouse',
          force: false,
          inputMode: 'disabled',
        },
        io.io,
      ),
    ).resolves.toBe(1);

    expect(io.stderr()).toContain('connection remove warehouse requires --force when input is disabled or not interactive');
  });

  it('returns a clear error when removing an unknown connection', async () => {
    const projectDir = join(tempDir, 'project');
    await initKloProject({ projectDir, projectName: 'warehouse' });
    const io = makeIo();

    await expect(
      runKloConnection(
        {
          command: 'remove',
          projectDir,
          connectionId: 'missing',
          force: true,
          inputMode: 'disabled',
        },
        io.io,
      ),
    ).resolves.toBe(1);

    expect(io.stderr()).toContain('Connection "missing" is not configured in klo.yaml');
  });

  it('asks for confirmation before removing in an interactive terminal', async () => {
    const projectDir = join(tempDir, 'project');
    await initKloProject({ projectDir, projectName: 'warehouse' });
    await runKloConnection(
      {
        command: 'add',
        projectDir,
        driver: 'sqlite',
        connectionId: 'warehouse',
        url: undefined,
        schemas: [],
        readonly: true,
        force: false,
        allowLiteralCredentials: false,
      },
      makeIo().io,
    );
    const io = makeIo({ stdoutIsTty: true, stdinIsTty: true });
    const prompts = {
      confirm: vi.fn(async () => true),
      cancel: vi.fn(),
    };

    await expect(
      runKloConnection(
        {
          command: 'remove',
          projectDir,
          connectionId: 'warehouse',
          force: false,
        },
        io.io,
        { prompts },
      ),
    ).resolves.toBe(0);

    expect(prompts.confirm).toHaveBeenCalledWith({
      message: 'Remove connection "warehouse" from klo.yaml? Ingested artifacts will remain in .klo/.',
      initialValue: false,
    });
  });

  it('runs public connect map as refresh, validate, and list over the low-level mapping runner', async () => {
    const io = makeIo();
    const runMapping = vi.fn(async (argv: string[], mappingIo: KloCliIo) => {
      if (argv[0] === 'refresh') {
        mappingIo.stdout.write('Discovery: 1 database\n');
        mappingIo.stdout.write('Unmapped discovered: 1\n');
        mappingIo.stdout.write('Stale mappings: 0\n');
        return 0;
      }
      if (argv[0] === 'validate') {
        mappingIo.stdout.write('Mapping validation passed: prod-metabase\n');
        return 0;
      }
      if (argv[0] === 'list') {
        mappingIo.stdout.write('1 -> [unmapped] (Analytics, sync: on, source: refresh)\n');
        return 0;
      }
      return 1;
    });

    await expect(
      runKloConnection(
        { command: 'map', projectDir: '/tmp/project', sourceConnectionId: 'prod-metabase', json: false },
        io.io,
        { runMapping },
      ),
    ).resolves.toBe(0);

    expect(runMapping).toHaveBeenNthCalledWith(
      1,
      ['refresh', 'prod-metabase', '--auto-accept', '--project-dir', '/tmp/project'],
      expect.any(Object),
    );
    expect(runMapping).toHaveBeenNthCalledWith(
      2,
      ['validate', 'prod-metabase', '--project-dir', '/tmp/project'],
      expect.any(Object),
    );
    expect(runMapping).toHaveBeenNthCalledWith(
      3,
      ['list', 'prod-metabase', '--project-dir', '/tmp/project'],
      expect.any(Object),
    );
    expect(io.stdout()).toContain('Mapping: prod-metabase');
    expect(io.stdout()).toContain('Discovery: 1 database');
    expect(io.stdout()).toContain('Mappings:');
    expect(io.stdout()).toContain('1 -> [unmapped]');
    expect(io.stdout()).toContain('Next:');
    expect(io.stdout()).toContain('klo ingest prod-metabase');
    expect(io.stdout()).toContain('klo dev mapping');
    expect(io.stderr()).toBe('');
  });

  it('prints stable JSON for public connect map without leaking low-level stdout', async () => {
    const io = makeIo();
    const runMapping = vi.fn(async (argv: string[], mappingIo: KloCliIo) => {
      if (argv[0] === 'refresh') {
        mappingIo.stdout.write('Discovery: 1 connection\nUnmapped discovered: 0\nStale mappings: 0\n');
        return 0;
      }
      if (argv[0] === 'validate') {
        mappingIo.stdout.write('Mapping validation passed: prod-looker\n');
        return 0;
      }
      if (argv[0] === 'list') {
        expect(argv).toContain('--json');
        mappingIo.stdout.write(
          `${JSON.stringify(
            [
              {
                lookerConnectionName: 'analytics',
                kloConnectionId: 'prod-warehouse',
                source: 'klo.yaml',
              },
            ],
            null,
            2,
          )}\n`,
        );
        return 0;
      }
      return 1;
    });

    await expect(
      runKloConnection(
        { command: 'map', projectDir: '/tmp/project', sourceConnectionId: 'prod-looker', json: true },
        io.io,
        { runMapping },
      ),
    ).resolves.toBe(0);

    const parsed = JSON.parse(io.stdout()) as {
      connectionId: string;
      refresh: { ok: boolean; output: string[] };
      validation: { ok: boolean; output: string[] };
      mappings: Array<{ lookerConnectionName: string; kloConnectionId: string; source: string }>;
    };
    expect(parsed).toEqual({
      connectionId: 'prod-looker',
      refresh: {
        ok: true,
        output: ['Discovery: 1 connection', 'Unmapped discovered: 0', 'Stale mappings: 0'],
      },
      validation: {
        ok: true,
        output: ['Mapping validation passed: prod-looker'],
      },
      mappings: [
        {
          lookerConnectionName: 'analytics',
          kloConnectionId: 'prod-warehouse',
          source: 'klo.yaml',
        },
      ],
    });
    expect(io.stderr()).toBe('');
  });

  it('returns the refresh failure when public connect map cannot discover source metadata', async () => {
    const io = makeIo();
    const runMapping = vi.fn(async (argv: string[], mappingIo: KloCliIo) => {
      if (argv[0] === 'refresh') {
        mappingIo.stderr.write('Metabase API key is not configured\n');
        return 1;
      }
      return 0;
    });

    await expect(
      runKloConnection(
        { command: 'map', projectDir: '/tmp/project', sourceConnectionId: 'prod-metabase', json: false },
        io.io,
        { runMapping },
      ),
    ).resolves.toBe(1);

    expect(runMapping).toHaveBeenCalledTimes(1);
    expect(io.stdout()).toBe('');
    expect(io.stderr()).toContain('Metabase API key is not configured');
  });

  it('rejects literal credential URLs unless explicitly allowed', async () => {
    const projectDir = join(tempDir, 'project');
    await initKloProject({ projectDir, projectName: 'warehouse' });
    const io = makeIo();

    await expect(
      runKloConnection(
        {
          command: 'add',
          projectDir,
          driver: 'postgres',
          connectionId: 'warehouse',
          url: 'postgres://localhost:5432/warehouse',
          schemas: [],
          readonly: true,
          force: false,
          allowLiteralCredentials: false,
        },
        io.io,
      ),
    ).resolves.toBe(1);

    expect(io.stderr()).toContain('Literal credential URLs require --allow-literal-credentials');
  });

  it('warns before writing explicitly allowed literal credential URLs without echoing the URL', async () => {
    const projectDir = join(tempDir, 'project');
    await initKloProject({ projectDir, projectName: 'warehouse' });
    const io = makeIo();
    const literalUrl = 'postgres://localhost:5432/warehouse';

    await expect(
      runKloConnection(
        {
          command: 'add',
          projectDir,
          driver: 'postgres',
          connectionId: 'warehouse',
          url: literalUrl,
          schemas: ['public'],
          readonly: true,
          force: false,
          allowLiteralCredentials: true,
        },
        io.io,
      ),
    ).resolves.toBe(0);

    expect(io.stderr()).toContain(
      'Warning: writing a literal credential URL to klo.yaml for connection "warehouse". Prefer env:NAME or file:/path references.',
    );
    expect(io.stderr()).not.toContain(literalUrl);
    await expect(readFile(join(projectDir, 'klo.yaml'), 'utf-8')).resolves.toContain(literalUrl);
  });

  it('adds a Notion connection without writing token values', async () => {
    const projectDir = join(tempDir, 'project');
    await initKloProject({ projectDir, projectName: 'warehouse' });
    const io = makeIo();

    await expect(
      runKloConnection(
        {
          command: 'add',
          projectDir,
          driver: 'notion',
          connectionId: 'notion-main',
          url: undefined,
          schemas: [],
          readonly: false,
          force: false,
          allowLiteralCredentials: false,
          notion: {
            authTokenRef: 'env:NOTION_AUTH_TOKEN',
            crawlMode: 'all_accessible',
            rootPageIds: [],
            rootDatabaseIds: [],
            rootDataSourceIds: [],
            maxPagesPerRun: 50,
            maxKnowledgeCreatesPerRun: 4,
            maxKnowledgeUpdatesPerRun: 12,
          },
        },
        io.io,
      ),
    ).resolves.toBe(0);

    const yaml = await readFile(join(projectDir, 'klo.yaml'), 'utf-8');
    expect(yaml).toContain('driver: notion');
    expect(yaml).toContain('auth_token_ref: env:NOTION_AUTH_TOKEN');
    expect(yaml).toContain('crawl_mode: all_accessible');
    expect(yaml).toContain('max_pages_per_run: 50');
    expect(yaml).not.toContain('ntn_');
    expect(io.stdout()).toContain('Connection: notion-main');
    expect(io.stdout()).toContain('Driver: notion');
  });

  it('runs connection notion pick --no-input through the public connection entrypoint', async () => {
    const projectDir = join(tempDir, 'project');
    await initKloProject({ projectDir, projectName: 'warehouse' });
    await runKloConnection(
      {
        command: 'add',
        projectDir,
        driver: 'notion',
        connectionId: 'notion-main',
        url: undefined,
        schemas: [],
        readonly: false,
        force: false,
        allowLiteralCredentials: false,
        notion: {
          authTokenRef: 'env:NOTION_AUTH_TOKEN',
          crawlMode: 'all_accessible',
          rootPageIds: [],
          rootDatabaseIds: ['database-1'],
          rootDataSourceIds: ['data-source-1'],
          maxPagesPerRun: 50,
          maxKnowledgeCreatesPerRun: 4,
          maxKnowledgeUpdatesPerRun: 12,
        },
      },
      makeIo().io,
    );
    const io = makeIo();

    await expect(
      runKloCli(
        [
          'connection',
          'notion',
          'pick',
          'notion-main',
          '--project-dir',
          projectDir,
          '--no-input',
          '--root-page-id',
          '11111111222233334444555555555555',
        ],
        io.io,
      ),
    ).resolves.toBe(0);

    const yaml = await readFile(join(projectDir, 'klo.yaml'), 'utf-8');
    expect(yaml).toContain('crawl_mode: selected_roots');
    expect(yaml).toContain('11111111-2222-3333-4444-555555555555');
    expect(yaml).toContain('database-1');
    expect(yaml).toContain('data-source-1');
    expect(io.stdout()).toContain('Connection: notion-main');
  });

  it('tests a configured connection through the native scan connector', async () => {
    const projectDir = join(tempDir, 'project');
    await initKloProject({ projectDir, projectName: 'warehouse' });
    await runKloConnection(
      {
        command: 'add',
        projectDir,
        driver: 'sqlite',
        connectionId: 'warehouse',
        url: undefined,
        schemas: [],
        readonly: true,
        force: false,
        allowLiteralCredentials: false,
      },
      makeIo().io,
    );
    const { connector, introspect, cleanup } = nativeConnector('sqlite', ['customers', 'orders']);
    const createScanConnector = vi.fn(async () => connector);
    const io = makeIo();

    await expect(
      runKloConnection({ command: 'test', projectDir, connectionId: 'warehouse' }, io.io, {
        createScanConnector,
      }),
    ).resolves.toBe(0);

    expect(createScanConnector).toHaveBeenCalledWith(expect.objectContaining({ projectDir }), 'warehouse');
    expect(introspect).toHaveBeenCalledWith(
      {
        connectionId: 'warehouse',
        driver: 'sqlite',
        mode: 'structural',
        dryRun: true,
        detectRelationships: false,
      },
      { runId: 'connection-test-warehouse' },
    );
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(io.stdout()).toContain('Connection test passed: warehouse');
    expect(io.stdout()).toContain('Driver: sqlite');
    expect(io.stdout()).toContain('Tables: 2');
  });

  it('cleans up the native scan connector when connection testing fails', async () => {
    const projectDir = join(tempDir, 'project');
    await initKloProject({ projectDir, projectName: 'warehouse' });
    await runKloConnection(
      {
        command: 'add',
        projectDir,
        driver: 'sqlite',
        connectionId: 'warehouse',
        url: undefined,
        schemas: [],
        readonly: true,
        force: false,
        allowLiteralCredentials: false,
      },
      makeIo().io,
    );
    const cleanup = vi.fn(async () => undefined);
    const connector: KloScanConnector = {
      id: 'sqlite:warehouse',
      driver: 'sqlite',
      capabilities: {
        structuralIntrospection: true,
        tableSampling: false,
        columnSampling: false,
        columnStats: false,
        readOnlySql: false,
        nestedAnalysis: false,
        eventStreamDiscovery: false,
        formalForeignKeys: false,
        estimatedRowCounts: false,
      },
      introspect: vi.fn(async () => {
        throw new Error('database file is unreadable');
      }),
      cleanup,
    };
    const io = makeIo();

    await expect(
      runKloConnection({ command: 'test', projectDir, connectionId: 'warehouse' }, io.io, {
        createScanConnector: vi.fn(async () => connector),
      }),
    ).resolves.toBe(1);

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(io.stderr()).toContain('database file is unreadable');
  });
});

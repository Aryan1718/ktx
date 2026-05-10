import type { KloConnectionMetabaseSetupArgs } from './commands/connection-metabase-setup.js';
import type { KloConnectionNotionArgs } from './commands/connection-notion.js';
import type { KloAgentArgs } from './agent.js';
import type { KloConnectionArgs } from './connection.js';
import type { KloDemoArgs } from './demo.js';
import type { KloDoctorArgs } from './doctor.js';
import type { KloIngestArgs } from './ingest.js';
import type { KloKnowledgeArgs } from './knowledge.js';
import type { KloPublicIngestArgs } from './public-ingest.js';
import type { KloScanArgs } from './scan.js';
import type { KloServeArgs } from './serve.js';
import type { KloSetupArgs } from './setup.js';
import type { KloSlArgs } from './sl.js';
import { profileMark, profileSpan } from './startup-profile.js';

profileMark('module:cli-runtime');

export interface KloCliPackageInfo {
  name: '@klo/cli';
  version: '0.0.0-private';
  contextPackageName: '@klo/context';
}

export interface KloCliIo {
  stdout: { isTTY?: boolean; write(chunk: string): void };
  stderr: { write(chunk: string): void };
}

export interface KloCliDeps {
  serveStdio?: (args: KloServeArgs) => Promise<number>;
  setup?: (args: KloSetupArgs, io: KloCliIo) => Promise<number>;
  agent?: (args: KloAgentArgs, io: KloCliIo) => Promise<number>;
  connection?: (args: KloConnectionArgs, io: KloCliIo) => Promise<number>;
  connectionNotion?: (args: KloConnectionNotionArgs, io: KloCliIo) => Promise<number>;
  connectionMetabaseSetup?: (args: KloConnectionMetabaseSetupArgs, io: KloCliIo) => Promise<number>;
  demo?: (args: KloDemoArgs, io: KloCliIo) => Promise<number>;
  doctor?: (args: KloDoctorArgs, io: KloCliIo) => Promise<number>;
  ingest?: (args: KloIngestArgs, io: KloCliIo) => Promise<number>;
  publicIngest?: (args: KloPublicIngestArgs, io: KloCliIo) => Promise<number>;
  scan?: (args: KloScanArgs, io: KloCliIo) => Promise<number>;
  knowledge?: (args: KloKnowledgeArgs, io: KloCliIo) => Promise<number>;
  sl?: (args: KloSlArgs, io: KloCliIo) => Promise<number>;
}

export function getKloCliPackageInfo(): KloCliPackageInfo {
  return {
    name: '@klo/cli',
    version: '0.0.0-private',
    contextPackageName: '@klo/context',
  };
}

async function runInit(
  args: { projectDir: string; projectName?: string; force: boolean },
  io: KloCliIo,
): Promise<number> {
  const { initKloProject } = await import('@klo/context/project');
  const result = await initKloProject({
    projectDir: args.projectDir,
    projectName: args.projectName,
    force: args.force,
  });

  io.stdout.write(`Initialized KLO project at ${result.projectDir}\n`);
  io.stdout.write(`Config: ${result.configPath}\n`);
  io.stdout.write(`Commit: ${result.commitHash ?? 'none'}\n`);
  return 0;
}

export async function runInitForCommander(
  args: { projectDir: string; projectName?: string; force: boolean },
  io: KloCliIo,
): Promise<number> {
  return await runInit(args, io);
}

export async function runKloCli(
  argv = process.argv.slice(2),
  io: KloCliIo = process,
  deps: KloCliDeps = {},
): Promise<number> {
  const info = getKloCliPackageInfo();
  profileMark('runtime:runKloCli');
  const { runCommanderKloCli } = await profileSpan('import ./cli-program.js', () => import('./cli-program.js'));

  return await runCommanderKloCli(argv, io, deps, info, {
    runInit: runInitForCommander,
  });
}

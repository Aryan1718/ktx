import { Command, InvalidArgumentError } from '@commander-js/extra-typings';
import type { KloCliDeps, KloCliIo, KloCliPackageInfo } from './cli-runtime.js';
import { registerAgentCommands } from './commands/agent-commands.js';
import { registerConnectionCommands } from './commands/connection-commands.js';
import { registerWikiCommands } from './commands/knowledge-commands.js';
import { registerPublicIngestCommands } from './commands/public-ingest-commands.js';
import { registerServeCommands } from './commands/serve-commands.js';
import { registerSetupCommands } from './commands/setup-commands.js';
import { registerSlCommands } from './commands/sl-commands.js';
import { registerStatusCommands } from './commands/status-commands.js';
import { registerDevCommands } from './dev.js';
import { findNearestKloProjectDir, resolveKloProjectDir } from './project-resolver.js';
import { profileMark, profileSpan } from './startup-profile.js';

profileMark('module:cli-program');

export interface KloCliCommandContext {
  io: KloCliIo;
  deps: KloCliDeps;
  setExitCode: (code: number) => void;
  runInit: (args: { projectDir: string; projectName?: string; force: boolean }, io: KloCliIo) => Promise<number>;
  writeDebug?: (command: string, commandContext: CommandWithGlobalOptions) => void;
}

export interface OutputModeOptions {
  plain?: boolean;
  json?: boolean;
  viz?: boolean;
  input?: boolean;
}

interface KloCommanderProgramOptions {
  runInit: (args: { projectDir: string; projectName?: string; force: boolean }, io: KloCliIo) => Promise<number>;
}

type CommanderExitLike = { exitCode: number; code: string; message: string };

interface KloGlobalOptionValues {
  projectDir?: string;
  debug?: boolean;
}

export interface CommandWithGlobalOptions {
  opts: () => object;
  optsWithGlobals?: () => object;
}

function isCommanderExit(error: unknown): error is CommanderExitLike {
  return (
    typeof error === 'object' &&
    error !== null &&
    'exitCode' in error &&
    typeof (error as { exitCode: unknown }).exitCode === 'number' &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  );
}

export function collectOption(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export function parsePositiveIntegerOption(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError('must be a positive integer');
  }
  return parsed;
}

export function parseNonNegativeIntegerOption(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError('must be a non-negative integer');
  }
  return parsed;
}

export function parseBooleanStringOption(value: string): boolean {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  throw new InvalidArgumentError('must be true or false');
}

export function parseSafeConnectionIdOption(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value)) {
    throw new InvalidArgumentError(`Unsafe connection id: ${value}`);
  }
  return value;
}

export function parseNonEmptyAssignmentOption(value: string): { key: string; value: string } {
  const separatorIndex = value.indexOf('=');
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    throw new InvalidArgumentError('must be a non-empty <key>=<value> assignment');
  }
  return {
    key: value.slice(0, separatorIndex),
    value: value.slice(separatorIndex + 1),
  };
}

function optionsWithGlobals(command: CommandWithGlobalOptions): KloGlobalOptionValues {
  const options = command.optsWithGlobals ? command.optsWithGlobals() : command.opts();
  const values = options as { projectDir?: unknown; debug?: unknown };
  return {
    projectDir: typeof values.projectDir === 'string' ? values.projectDir : undefined,
    debug: typeof values.debug === 'boolean' ? values.debug : undefined,
  };
}

export function resolveCommandProjectDir(command: CommandWithGlobalOptions): string {
  return resolveKloProjectDir({ explicitProjectDir: optionsWithGlobals(command).projectDir });
}

export function resolveCommandProjectDirOverride(command: CommandWithGlobalOptions): string | undefined {
  return optionsWithGlobals(command).projectDir ?? process.env.KLO_PROJECT_DIR;
}

function createBaseProgram(info: KloCliPackageInfo, io: KloCliIo): Command {
  return new Command()
    .name('klo')
    .description('Standalone KLO developer CLI')
    .option('--project-dir <path>', 'KLO project directory (default: KLO_PROJECT_DIR, nearest klo.yaml, or cwd)')
    .option('--debug', 'Enable diagnostic logging to stderr')
    .version(`${info.name} ${info.version}`, '-v, --version', 'Show CLI version')
    .helpOption('-h, --help', 'Show this help text')
    .configureHelp({ showGlobalOptions: true })
    .addHelpText(
      'after',
      '\nAdvanced:\n  klo dev        Low-level diagnostics, scans, adapter commands, and mapping tools.\n',
    )
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({
      writeOut: (chunk) => io.stdout.write(chunk),
      writeErr: (chunk) => io.stderr.write(chunk),
      outputError: (chunk, write) => write(chunk),
    });
}

function writeDebug(io: KloCliIo, commandContext: CommandWithGlobalOptions, command: string): void {
  const global = optionsWithGlobals(commandContext);
  if (global.debug !== true) {
    return;
  }
  io.stderr.write(`[debug] projectDir=${resolveCommandProjectDir(commandContext)}\n`);
  io.stderr.write(`[debug] dispatch=${command}\n`);
}

function formatCliError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runBareInteractiveCommand(
  program: Command,
  io: KloCliIo,
  context: KloCliCommandContext,
): Promise<number> {
  const nearestProjectDir = findNearestKloProjectDir(process.cwd());
  const envProjectDir = process.env.KLO_PROJECT_DIR;
  const runner = context.deps.setup ?? (await import('./setup.js')).runKloSetup;

  if (!nearestProjectDir && !envProjectDir) {
    return await runner(
      {
        command: 'run',
        projectDir: resolveKloProjectDir(),
        mode: 'auto',
        agents: false,
        agentScope: 'project',
        agentInstallMode: 'cli',
        skipAgents: false,
        inputMode: 'auto',
        yes: false,
        skipLlm: false,
        skipEmbeddings: false,
        databaseSchemas: [],
        skipDatabases: false,
        skipSources: false,
      },
      io,
    );
  }

  program.outputHelp();
  return 0;
}

export async function runCommanderKloCli(
  argv: string[],
  io: KloCliIo,
  deps: KloCliDeps,
  info: KloCliPackageInfo,
  options: KloCommanderProgramOptions,
): Promise<number> {
  profileMark('commander:entry');
  let exitCode = 0;
  const program = createBaseProgram(info, io);
  profileMark('commander:base-program');
  const context: KloCliCommandContext = {
    io,
    deps,
    setExitCode: (code: number) => {
      exitCode = code;
    },
    runInit: options.runInit,
    writeDebug: (command: string, commandContext: CommandWithGlobalOptions) => {
      writeDebug(io, commandContext, command);
    },
  };

  registerSetupCommands(program, context);
  profileMark('commander:register-setup');

  registerConnectionCommands(program, context);
  profileMark('commander:register-connection');

  registerPublicIngestCommands(program, context);
  profileMark('commander:register-public-ingest');

  registerWikiCommands(program, context);
  profileMark('commander:register-wiki');

  registerSlCommands(program, context);
  profileMark('commander:register-sl');

  registerServeCommands(program, context);
  profileMark('commander:register-serve');

  registerStatusCommands(program, context);
  profileMark('commander:register-status');

  registerAgentCommands(program, context);
  profileMark('commander:register-agent');

  registerDevCommands(program, context);
  profileMark('commander:register-dev');

  if (argv.length === 0) {
    if (io.stdout.isTTY === true) {
      try {
        return await runBareInteractiveCommand(program, io, context);
      } catch (error) {
        io.stderr.write(`${formatCliError(error)}\n`);
        return 1;
      }
    }
    program.outputHelp();
    return 0;
  }

  try {
    await profileSpan('commander:parseAsync', () => program.parseAsync(argv, { from: 'user' }));
  } catch (error) {
    if (isCommanderExit(error)) {
      return error.exitCode === 0 ? 0 : 1;
    }
    io.stderr.write(`${formatCliError(error)}\n`);
    return 1;
  }

  return exitCode;
}

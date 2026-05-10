import type { Command } from '@commander-js/extra-typings';
import { type CommandWithGlobalOptions, type KloCliCommandContext, resolveCommandProjectDir } from '../cli-program.js';
import type { KloDoctorArgs } from '../doctor.js';
import { profileMark } from '../startup-profile.js';

profileMark('module:commands/doctor-commands');

function outputMode(options: { json?: boolean }): 'plain' | 'json' {
  return options.json === true ? 'json' : 'plain';
}

function inputMode(options: { input?: boolean }): { inputMode?: 'disabled' } {
  return options.input === false ? { inputMode: 'disabled' } : {};
}

async function runDoctorArgs(context: KloCliCommandContext, args: KloDoctorArgs): Promise<void> {
  const runner = context.deps.doctor ?? (await import('../doctor.js')).runKloDoctor;
  context.setExitCode(await runner(args, context.io));
}

export function registerDoctorCommands(program: Command, context: KloCliCommandContext): void {
  const doctor = program
    .command('doctor')
    .description('Check KLO setup, project, and demo readiness')
    .option('--json', 'Print JSON output', false)
    .option('--no-input', 'Disable interactive terminal input')
    .action(async (options: { json?: boolean; input?: boolean }, command) => {
      await runDoctorArgs(context, {
        command: 'project',
        projectDir: resolveCommandProjectDir(command),
        outputMode: outputMode(options),
        ...inputMode(options),
      });
    });

  doctor
    .command('setup')
    .description('Check KLO install, build, and local runtime readiness')
    .option('--json', 'Print JSON output', false)
    .option('--no-input', 'Disable interactive terminal input')
    .action(
      async (
        _options: { json?: boolean; input?: boolean },
        command: CommandWithGlobalOptions,
      ) => {
        const options = (command.optsWithGlobals ? command.optsWithGlobals() : command.opts()) as {
          json?: boolean;
          input?: boolean;
        };
        await runDoctorArgs(context, { command: 'setup', outputMode: outputMode(options), ...inputMode(options) });
      },
    );
}

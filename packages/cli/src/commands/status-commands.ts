import type { Command } from '@commander-js/extra-typings';
import type { KloCliCommandContext } from '../cli-program.js';
import { resolveCommandProjectDir } from '../cli-program.js';

export function registerStatusCommands(program: Command, context: KloCliCommandContext): void {
  program
    .command('status')
    .description('Show current KLO project setup status')
    .option('--json', 'Print JSON output', false)
    .action(async (options: { json?: boolean }, command) => {
      const runner = context.deps.setup ?? (await import('../setup.js')).runKloSetup;
      context.setExitCode(
        await runner(
          {
            command: 'status',
            projectDir: resolveCommandProjectDir(command),
            json: options.json === true,
          },
          context.io,
        ),
      );
    });
}

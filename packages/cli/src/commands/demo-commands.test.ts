import { describe, expect, it } from 'vitest';
import { resolveDemoCommandOptions } from './demo-commands.js';

describe('resolveDemoCommandOptions', () => {
  it('lets parent --no-input override a child default from optsWithGlobals', () => {
    const rootCommand = {
      opts: () => ({}),
    };
    const setupCommand = {
      parent: rootCommand,
      opts: () => ({ input: false }),
      getOptionValueSource: (name: string) => (name === 'input' ? 'cli' : undefined),
    };
    const demoCommand = {
      parent: setupCommand,
      opts: () => ({ input: true, mode: 'seeded' }),
      optsWithGlobals: () => ({ input: true, mode: 'seeded' }),
      getOptionValueSource: (name: string) => (name === 'input' ? 'default' : name === 'mode' ? 'default' : undefined),
    };

    expect(resolveDemoCommandOptions<{ input: boolean; mode: string }>(demoCommand)).toEqual({
      input: false,
      mode: 'seeded',
    });
  });
});

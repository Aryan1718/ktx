import { describe, expect, it } from 'vitest';
import {
  KLO_CONTEXT_BUILD_COMMANDS,
  KLO_NEXT_STEP_COMMANDS,
  formatNextStepLines,
  formatSetupNextStepLines,
} from './next-steps.js';

const command = (...parts: string[]) => parts.join(' ');

describe('KLO demo next steps', () => {
  it('uses supported context-build commands before agent usage', () => {
    expect(KLO_CONTEXT_BUILD_COMMANDS).toEqual([
      {
        command: 'klo setup context build',
        description: 'Build agent-ready context from configured primary and context sources',
      },
      {
        command: 'klo status',
        description: 'Check setup and context readiness',
      },
      {
        command: 'klo setup context status',
        description: 'Check the setup-managed context build state',
      },
    ]);
  });

  it('uses supported final public commands', () => {
    expect(KLO_NEXT_STEP_COMMANDS).toEqual([
      {
        command: 'klo agent context --json',
        description: 'Verify the project context your agent can read',
      },
      {
        command: 'klo agent tools --json',
        description: 'List direct CLI tools available to agents',
      },
      {
        command: 'klo sl list',
        description: 'Inspect generated semantic-layer sources',
      },
      {
        command: 'klo wiki list',
        description: 'Inspect generated wiki pages',
      },
      {
        command: 'klo serve --mcp stdio --user-id local',
        description: 'Optional MCP server route for clients that require MCP',
      },
    ]);
  });

  it('prefers the direct CLI route before MCP serving', () => {
    const commands = KLO_NEXT_STEP_COMMANDS.map((step) => step.command);

    expect(commands.indexOf('klo agent context --json')).toBeLessThan(
      commands.indexOf('klo serve --mcp stdio --user-id local'),
    );
    expect(commands.indexOf('klo agent tools --json')).toBeLessThan(
      commands.indexOf('klo serve --mcp stdio --user-id local'),
    );
  });

  it('explains what the next-step commands are for', () => {
    const rendered = formatNextStepLines().join('\n');

    expect(rendered).toContain('KLO context is ready for agents.');
    expect(rendered).toContain('Preferred route: CLI + Skills');
    expect(rendered).toContain('no MCP server is required');
    expect(rendered).toContain('Direct CLI checks:');
    expect(rendered).toContain('Optional MCP:');
    expect(rendered).not.toContain('Ask your agent to use KLO');
  });

  it('does not advertise removed Commander migration commands', () => {
    const rendered = formatNextStepLines().join('\n');

    expect(rendered).toContain('klo agent tools --json');
    expect(rendered).toContain('klo agent context --json');
    expect(rendered).toContain('klo sl list');
    expect(rendered).toContain('klo wiki list');
    expect(rendered).toContain('klo serve --mcp stdio --user-id local');

    for (const removed of [
      command('klo', 'ask'),
      command('klo', 'mcp'),
      command('klo', 'connect'),
      command('klo', 'knowledge'),
      command('dev', 'model'),
      command('dev', 'knowledge'),
      command('klo', 'ingest', 'run'),
      command('klo', 'ingest', 'replay'),
    ]) {
      expect(rendered).not.toContain(removed);
    }
  });

  it('keeps setup next steps focused on building context when the build is not ready', () => {
    const rendered = formatSetupNextStepLines({
      setupReady: true,
      hasContextTargets: true,
      contextReady: false,
      agentIntegrationReady: true,
    }).join('\n');

    expect(rendered).toContain('Build KLO context next.');
    expect(rendered).toContain('primary-source scans and context-source ingests');
    expect(rendered).toContain('klo setup context build');
    expect(rendered).toContain('klo status');
    expect(rendered).toContain('klo setup context status');
    expect(rendered).not.toContain('klo agent context --json');
    expect(rendered).not.toContain('klo serve --mcp');
  });

  it('shows agent commands only after setup and context build are ready', () => {
    const rendered = formatSetupNextStepLines({
      setupReady: true,
      hasContextTargets: true,
      contextReady: true,
      agentIntegrationReady: true,
    }).join('\n');

    expect(rendered).toContain('KLO context is ready for agents.');
    expect(rendered).toContain('klo agent context --json');
    expect(rendered).toContain('klo serve --mcp stdio --user-id local');
    expect(rendered).not.toContain('Build KLO context next.');
  });
});

export const KLO_CONTEXT_BUILD_COMMANDS = [
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
] as const;

export const KLO_NEXT_STEP_DIRECT_COMMANDS = [
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
] as const;

export const KLO_NEXT_STEP_MCP_COMMANDS = [
  {
    command: 'klo serve --mcp stdio --user-id local',
    description: 'Optional MCP server route for clients that require MCP',
  },
] as const;

export const KLO_NEXT_STEP_COMMANDS = [...KLO_NEXT_STEP_DIRECT_COMMANDS, ...KLO_NEXT_STEP_MCP_COMMANDS] as const;

export const KLO_NEXT_STEP_COMMAND_WIDTH = Math.max(
  ...[...KLO_CONTEXT_BUILD_COMMANDS, ...KLO_NEXT_STEP_COMMANDS].map((step) => step.command.length),
);

export interface KloSetupNextStepState {
  setupReady: boolean;
  hasContextTargets: boolean;
  contextReady: boolean;
  agentIntegrationReady: boolean;
}

function commandLines(commands: ReadonlyArray<{ command: string; description: string }>, indent: string): string[] {
  return commands.map((step) => `${indent}$ ${step.command.padEnd(KLO_NEXT_STEP_COMMAND_WIDTH)}  ${step.description}`);
}

export function formatNextStepLines(indent = '  '): string[] {
  return [
    `${indent}KLO context is ready for agents.`,
    `${indent}Preferred route: CLI + Skills; installed rules call \`klo agent ...\` directly, so no MCP server is required.`,
    `${indent}Direct CLI checks:`,
    ...commandLines(KLO_NEXT_STEP_DIRECT_COMMANDS, indent),
    `${indent}Optional MCP:`,
    ...commandLines(KLO_NEXT_STEP_MCP_COMMANDS, indent),
  ];
}

export function formatSetupNextStepLines(state: KloSetupNextStepState, indent = '  '): string[] {
  if (!state.setupReady) {
    return [
      `${indent}Finish setup first.`,
      `${indent}$ ${'klo setup'.padEnd(KLO_NEXT_STEP_COMMAND_WIDTH)}  Resume configuration and validation`,
      `${indent}$ ${'klo status'.padEnd(KLO_NEXT_STEP_COMMAND_WIDTH)}  Check which setup steps still need attention`,
    ];
  }

  if (!state.hasContextTargets) {
    return [
      `${indent}Connect data, then build context.`,
      `${indent}$ ${'klo setup'.padEnd(KLO_NEXT_STEP_COMMAND_WIDTH)}  Add primary or context sources`,
      `${indent}$ ${'klo status'.padEnd(KLO_NEXT_STEP_COMMAND_WIDTH)}  Check setup and context readiness`,
    ];
  }

  if (!state.contextReady) {
    return [
      `${indent}Build KLO context next.`,
      `${indent}Preferred route: run the CLI build; it covers primary-source scans and context-source ingests.`,
      ...commandLines(KLO_CONTEXT_BUILD_COMMANDS, indent),
    ];
  }

  if (!state.agentIntegrationReady) {
    return [
      `${indent}KLO context is built. Install agent rules when you want your coding agent to use it.`,
      `${indent}$ ${'klo setup --agents'.padEnd(KLO_NEXT_STEP_COMMAND_WIDTH)}  Install CLI-based agent rules`,
      `${indent}$ ${'klo status'.padEnd(KLO_NEXT_STEP_COMMAND_WIDTH)}  Check setup and context readiness`,
    ];
  }

  return formatNextStepLines(indent);
}

import type { KloProjectConfig } from './config.js';

export const KLO_SETUP_STEPS = ['project', 'llm', 'embeddings', 'databases', 'sources', 'context', 'agents'] as const;

export type KloSetupStep = (typeof KLO_SETUP_STEPS)[number];

const SETUP_GITIGNORE_ENTRIES = ['secrets/', 'setup/', 'agents/'] as const;

export function markKloSetupStepComplete(config: KloProjectConfig, step: KloSetupStep): KloProjectConfig {
  const databaseConnectionIds = config.setup?.database_connection_ids ?? [];
  const completedSteps = config.setup?.completed_steps ?? [];
  return {
    ...config,
    setup: {
      database_connection_ids: [...databaseConnectionIds],
      completed_steps: completedSteps.includes(step) ? [...completedSteps] : [...completedSteps, step],
    },
  };
}

export function setKloSetupDatabaseConnectionIds(
  config: KloProjectConfig,
  connectionIds: string[],
  options: { complete?: boolean } = {},
): KloProjectConfig {
  const uniqueConnectionIds = [...new Set(connectionIds.filter((connectionId) => connectionId.trim().length > 0))];
  const completedSteps = config.setup?.completed_steps ?? [];
  const nextCompletedSteps =
    options.complete === true && !completedSteps.includes('databases')
      ? [...completedSteps, 'databases']
      : [...completedSteps];

  return {
    ...config,
    setup: {
      database_connection_ids: uniqueConnectionIds,
      completed_steps: nextCompletedSteps,
    },
  };
}

export function mergeKloSetupGitignoreEntries(content: string): string {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line, index, all) => line.length > 0 || index < all.length - 1);
  const existing = new Set(lines);
  for (const entry of SETUP_GITIGNORE_ENTRIES) {
    if (!existing.has(entry)) {
      lines.push(entry);
      existing.add(entry);
    }
  }
  return `${lines.join('\n')}\n`;
}

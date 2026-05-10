import { cancel, isCancel, select } from '@clack/prompts';
import { withMenuOptionsSpacing } from './prompt-navigation.js';
import type { KloSetupStatus } from './setup.js';
import { withSetupInterruptConfirmation } from './setup-interrupt.js';

export type KloSetupReadyAction = 'models' | 'embeddings' | 'databases' | 'sources' | 'context' | 'agents' | 'exit';

export interface KloSetupReadyMenuPromptAdapter {
  select(options: { message: string; options: Array<{ value: string; label: string }> }): Promise<string>;
  cancel(message: string): void;
}

export interface KloSetupReadyMenuDeps {
  prompts?: KloSetupReadyMenuPromptAdapter;
}

export function isKloSetupReady(status: KloSetupStatus): boolean {
  return (
    status.project.ready &&
    status.llm.ready &&
    status.embeddings.ready &&
    status.databases.every((database) => database.ready) &&
    status.sources.every((source) => source.ready) &&
    status.context.ready &&
    status.agents.some((agent) => agent.ready)
  );
}

function createPromptAdapter(): KloSetupReadyMenuPromptAdapter {
  return {
    async select(options) {
      const value = await withSetupInterruptConfirmation(() => select(withMenuOptionsSpacing(options)));
      if (isCancel(value)) {
        cancel('Setup cancelled.');
        return 'exit';
      }
      return String(value);
    },
    cancel(message) {
      cancel(message);
    },
  };
}

export async function runKloSetupReadyChangeMenu(
  status: KloSetupStatus,
  deps: KloSetupReadyMenuDeps = {},
): Promise<{ action: KloSetupReadyAction }> {
  const prompts = deps.prompts ?? createPromptAdapter();
  const action = (await prompts.select({
    message: `KLO is already set up for ${status.project.name ?? status.project.path}. What would you like to change?`,
    options: [
      { value: 'models', label: 'Models' },
      { value: 'embeddings', label: 'Embeddings' },
      { value: 'databases', label: 'Primary sources' },
      { value: 'sources', label: 'Context sources' },
      { value: 'context', label: 'Rebuild KLO context' },
      { value: 'agents', label: 'Agent integration' },
      { value: 'exit', label: 'Exit' },
    ],
  })) as KloSetupReadyAction;
  return { action };
}

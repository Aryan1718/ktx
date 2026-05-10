import { describe, expect, it, vi } from 'vitest';
import { isKloSetupReady, runKloSetupReadyChangeMenu } from './setup-ready-menu.js';
import type { KloSetupStatus } from './setup.js';

const readyStatus: KloSetupStatus = {
  project: { path: '/tmp/revenue', ready: true },
  llm: { backend: 'anthropic', ready: true, model: 'claude-sonnet-4-6' },
  embeddings: { backend: 'openai', ready: true, model: 'text-embedding-3-small', dimensions: 1536 },
  databases: [{ connectionId: 'warehouse', ready: true }],
  sources: [],
  context: { ready: true, status: 'completed' },
  agents: [{ target: 'codex', scope: 'project', ready: true }],
};

describe('setup ready menu', () => {
  it('recognizes a ready setup only when required sections are ready', () => {
    expect(isKloSetupReady(readyStatus)).toBe(true);
    expect(isKloSetupReady({ ...readyStatus, embeddings: { ready: false } })).toBe(false);
    expect(isKloSetupReady({ ...readyStatus, context: { ready: false, status: 'not_started' } })).toBe(false);
    expect(isKloSetupReady({ ...readyStatus, agents: [] })).toBe(false);
  });

  it('maps ready-project menu choices to setup sections', async () => {
    const prompts = { select: vi.fn(async () => 'agents'), cancel: vi.fn() };

    await expect(runKloSetupReadyChangeMenu(readyStatus, { prompts })).resolves.toEqual({ action: 'agents' });

    expect(prompts.select).toHaveBeenCalledWith({
      message: 'KLO is already set up for /tmp/revenue. What would you like to change?',
      options: [
        { value: 'models', label: 'Models' },
        { value: 'embeddings', label: 'Embeddings' },
        { value: 'databases', label: 'Primary sources' },
        { value: 'sources', label: 'Context sources' },
        { value: 'context', label: 'Rebuild KLO context' },
        { value: 'agents', label: 'Agent integration' },
        { value: 'exit', label: 'Exit' },
      ],
    });
  });
});

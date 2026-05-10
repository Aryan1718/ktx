import { describe, expect, it } from 'vitest';
import { buildDefaultKloProjectConfig } from './config.js';
import {
  markKloSetupStepComplete,
  mergeKloSetupGitignoreEntries,
  setKloSetupDatabaseConnectionIds,
} from './setup-config.js';

describe('KLO setup config helpers', () => {
  it('marks setup steps complete without duplicating existing state', () => {
    const config = buildDefaultKloProjectConfig('warehouse');

    const withProject = markKloSetupStepComplete(config, 'project');
    const withProjectAgain = markKloSetupStepComplete(withProject, 'project');
    const withLlm = markKloSetupStepComplete(withProjectAgain, 'llm');
    const withContext = markKloSetupStepComplete(withLlm, 'context');

    expect(withProject.setup).toEqual({
      database_connection_ids: [],
      completed_steps: ['project'],
    });
    expect(withProjectAgain.setup?.completed_steps).toEqual(['project']);
    expect(withLlm.setup?.completed_steps).toEqual(['project', 'llm']);
    expect(withContext.setup?.completed_steps).toEqual(['project', 'llm', 'context']);
    expect(config.setup).toBeUndefined();
  });

  it('preserves database connection ids while marking a step complete', () => {
    const config = {
      ...buildDefaultKloProjectConfig('warehouse'),
      setup: {
        database_connection_ids: ['warehouse'],
        completed_steps: ['databases'],
      },
    };

    expect(markKloSetupStepComplete(config, 'project').setup).toEqual({
      database_connection_ids: ['warehouse'],
      completed_steps: ['databases', 'project'],
    });
  });

  it('sets setup database connection ids without duplicates', () => {
    const config = buildDefaultKloProjectConfig('warehouse');

    const withDatabases = setKloSetupDatabaseConnectionIds(config, ['warehouse', 'analytics', 'warehouse']);

    expect(withDatabases.setup).toEqual({
      database_connection_ids: ['warehouse', 'analytics'],
      completed_steps: [],
    });
    expect(config.setup).toBeUndefined();
  });

  it('marks databases complete only when requested', () => {
    const config = markKloSetupStepComplete(buildDefaultKloProjectConfig('warehouse'), 'project');

    const withDatabases = setKloSetupDatabaseConnectionIds(config, ['warehouse'], { complete: true });
    const withDatabasesAgain = setKloSetupDatabaseConnectionIds(withDatabases, ['warehouse'], { complete: true });

    expect(withDatabases.setup).toEqual({
      database_connection_ids: ['warehouse'],
      completed_steps: ['project', 'databases'],
    });
    expect(withDatabasesAgain.setup).toEqual(withDatabases.setup);
  });

  it('merges setup-local gitignore entries without removing existing lines', () => {
    expect(mergeKloSetupGitignoreEntries('cache/\ndb.sqlite\n')).toBe(
      ['cache/', 'db.sqlite', 'secrets/', 'setup/', 'agents/', ''].join('\n'),
    );
    expect(mergeKloSetupGitignoreEntries('cache/\nsecrets/\n')).toBe(
      ['cache/', 'secrets/', 'setup/', 'agents/', ''].join('\n'),
    );
  });
});

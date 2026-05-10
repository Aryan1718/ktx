import { describe, expect, it } from 'vitest';
import {
  isMissingProjectConfigError,
  missingConnectionSlSearchReadiness,
  missingProjectSlSearchReadiness,
  noConnectionsSlSearchReadiness,
  noIndexedSourcesSlSearchReadiness,
} from './agent-search-readiness.js';

describe('agent semantic-layer search readiness guidance', () => {
  it('formats missing project guidance with exact recovery commands', () => {
    expect(missingProjectSlSearchReadiness('/tmp/klo-search', 'gross revenue')).toEqual({
      code: 'agent_sl_search_missing_project',
      message: 'Semantic-layer search needs an initialized KLO project at /tmp/klo-search.',
      nextSteps: [
        'klo demo',
        'klo setup --project-dir /tmp/klo-search',
        'klo ingest <connection>',
        'klo agent sl list --json --query "gross revenue" --project-dir /tmp/klo-search',
      ],
    });
  });

  it('formats no-connection and no-index guidance without hiding the project path', () => {
    expect(noConnectionsSlSearchReadiness('/tmp/klo-search', 'revenue')).toMatchObject({
      code: 'agent_sl_search_no_connections',
      message: 'Semantic-layer search found no configured connections in /tmp/klo-search.',
    });
    expect(noIndexedSourcesSlSearchReadiness('/tmp/klo-search', 'orders')).toMatchObject({
      code: 'agent_sl_search_no_indexed_sources',
      message: 'Semantic-layer search found no indexed semantic-layer sources in /tmp/klo-search.',
    });
  });

  it('formats unknown connection guidance', () => {
    expect(missingConnectionSlSearchReadiness('/tmp/klo-search', 'warehouse', 'revenue')).toMatchObject({
      code: 'agent_sl_search_unknown_connection',
      message: 'Semantic-layer search connection "warehouse" is not configured in /tmp/klo-search.',
    });
  });

  it('detects missing klo.yaml read errors', () => {
    const error = Object.assign(new Error('ENOENT: no such file or directory'), {
      code: 'ENOENT',
      path: '/tmp/klo-search/klo.yaml',
    });

    expect(isMissingProjectConfigError(error)).toBe(true);
    expect(isMissingProjectConfigError(new Error('other'))).toBe(false);
  });
});

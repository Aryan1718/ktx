import { describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '../../tools/index.js';
import { WikiListTagsTool } from './wiki-list-tags.tool.js';

describe('WikiListTagsTool', () => {
  const baseContext: ToolContext = { sourceId: 's', messageId: 'm', userId: 'u' };

  it("returns distinct sorted tags across the user's visible pages", async () => {
    const pagesRepository = {
      listPagesForUser: vi.fn().mockResolvedValue([
        { scope: 'GLOBAL', scope_id: null, page_key: 'k1' },
        { scope: 'USER', scope_id: 'u', page_key: 'k2' },
      ]),
    };
    const wikiService = {
      readPage: vi.fn().mockImplementation((_scope, _scopeId, key) => {
        if (key === 'k1') {
          return Promise.resolve({ frontmatter: { tags: ['metrics', 'finance'] }, content: '' });
        }
        if (key === 'k2') {
          return Promise.resolve({ frontmatter: { tags: ['metrics'] }, content: '' });
        }
        return Promise.resolve(null);
      }),
    };
    const tool = new WikiListTagsTool(wikiService as any, pagesRepository as any);

    const result = await tool.call({}, baseContext);
    expect(result.markdown).toContain('finance');
    expect(result.markdown).toContain('metrics');
    expect(result.structured.tags).toEqual(['finance', 'metrics']);
  });

  it('returns a friendly message when no pages have tags', async () => {
    const pagesRepository = { listPagesForUser: vi.fn().mockResolvedValue([]) };
    const wikiService = { readPage: vi.fn() };
    const tool = new WikiListTagsTool(wikiService as any, pagesRepository as any);

    const result = await tool.call({}, baseContext);
    expect(result.markdown).toMatch(/no tags/i);
  });
});

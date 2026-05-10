import { describe, expect, it } from 'vitest';

import { kloContextPackageInfo } from './index.js';

describe('kloContextPackageInfo', () => {
  it('identifies the context package', () => {
    expect(kloContextPackageInfo).toEqual({
      name: '@klo/context',
      version: '0.0.0-private',
    });
  });
});

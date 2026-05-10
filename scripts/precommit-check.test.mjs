import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { planChecks } from './precommit-check.mjs';

function commandKeys(files) {
  return planChecks(files).map((command) => command.key);
}

describe('precommit-check', () => {
  it('skips files outside klo', () => {
    assert.deepEqual(commandKeys(['server/src/app.ts']), []);
  });

  it('runs only the touched package checks for package code', () => {
    assert.deepEqual(commandKeys(['klo/packages/cli/src/index.ts']), [
      'boundary-check',
      'type-check:@klo/cli',
      'build:@klo/cli',
      'test:@klo/cli',
    ]);
  });

  it('runs the matching script test when a script changes', () => {
    assert.deepEqual(commandKeys(['klo/scripts/check-boundaries.mjs']), [
      'script-test:scripts/check-boundaries.test.mjs',
    ]);
  });

  it('runs the touched python package tests', () => {
    assert.deepEqual(commandKeys(['klo/python/klo-sl/semantic_layer/parser.py']), ['pytest:klo-sl']);
  });
});

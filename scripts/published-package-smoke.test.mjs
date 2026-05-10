import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import {
  buildPublishedPackageNpxCommand,
  buildPublishedPackageSmokeCommands,
  publishedPackageSpec,
  readPublishedPackageSmokeConfig,
} from './published-package-smoke.mjs';

describe('published package smoke config', () => {
  it('skips by default until a published package name is supplied', () => {
    assert.deepEqual(readPublishedPackageSmokeConfig({}, []), {
      enabled: false,
      requireConfig: false,
      reason:
        'Set KLO_PUBLISHED_KLO_PACKAGE or release-policy.json publishedPackageSmoke.packageName to the published npm package name after the release decision.',
    });
  });

  it('can require the published package config for post-publication CI', () => {
    assert.deepEqual(readPublishedPackageSmokeConfig({}, ['--require-config']), {
      enabled: false,
      requireConfig: true,
      reason:
        'Set KLO_PUBLISHED_KLO_PACKAGE or release-policy.json publishedPackageSmoke.packageName to the published npm package name after the release decision.',
    });
  });

  it('reads the package, version, and registry from environment variables', () => {
    assert.deepEqual(
      readPublishedPackageSmokeConfig(
        {
          KLO_PUBLISHED_KLO_PACKAGE: '@klo/cli-public',
          KLO_PUBLISHED_KLO_VERSION: 'latest',
          KLO_PUBLISHED_KLO_REGISTRY: 'https://registry.npmjs.org/',
        },
        [],
      ),
      {
        enabled: true,
        requireConfig: false,
        configSource: 'environment',
        packageName: '@klo/cli-public',
        packageVersion: 'latest',
        registry: 'https://registry.npmjs.org/',
      },
    );
  });

  it('reads the package, version, and registry from release policy when env vars are absent', () => {
    assert.deepEqual(
      readPublishedPackageSmokeConfig(
        {},
        [],
        {
          packageName: '@klo/cli-public',
          version: '2026.5.8',
          registry: 'https://registry.npmjs.org/',
        },
      ),
      {
        enabled: true,
        requireConfig: false,
        configSource: 'release-policy',
        packageName: '@klo/cli-public',
        packageVersion: '2026.5.8',
        registry: 'https://registry.npmjs.org/',
      },
    );
  });

  it('lets environment variables override release policy values', () => {
    assert.deepEqual(
      readPublishedPackageSmokeConfig(
        {
          KLO_PUBLISHED_KLO_PACKAGE: '@klo/cli-from-env',
          KLO_PUBLISHED_KLO_VERSION: 'latest',
        },
        [],
        {
          packageName: '@klo/cli-from-policy',
          version: '2026.5.8',
          registry: 'https://registry.npmjs.org/',
        },
      ),
      {
        enabled: true,
        requireConfig: false,
        configSource: 'environment',
        packageName: '@klo/cli-from-env',
        packageVersion: 'latest',
        registry: 'https://registry.npmjs.org/',
      },
    );
  });

  it('rejects package names that would be unsafe as npx package specs', () => {
    assert.throws(
      () => readPublishedPackageSmokeConfig({ KLO_PUBLISHED_KLO_PACKAGE: '--package=@evil/pkg' }, []),
      /Invalid KLO_PUBLISHED_KLO_PACKAGE/,
    );
    assert.throws(
      () => readPublishedPackageSmokeConfig({ KLO_PUBLISHED_KLO_PACKAGE: '@klo/cli public' }, []),
      /Invalid KLO_PUBLISHED_KLO_PACKAGE/,
    );
    assert.throws(
      () =>
        readPublishedPackageSmokeConfig(
          {},
          [],
          {
            packageName: '@klo/cli public',
            version: 'latest',
            registry: null,
          },
        ),
      /Invalid release-policy\.json publishedPackageSmoke\.packageName/,
    );
  });

  it('rejects unsafe version tags and non-HTTP registries', () => {
    assert.throws(
      () =>
        readPublishedPackageSmokeConfig(
          {
            KLO_PUBLISHED_KLO_PACKAGE: '@klo/cli-public',
            KLO_PUBLISHED_KLO_VERSION: '--tag latest',
          },
          [],
        ),
      /Invalid KLO_PUBLISHED_KLO_VERSION/,
    );
    assert.throws(
      () =>
        readPublishedPackageSmokeConfig(
          {
            KLO_PUBLISHED_KLO_PACKAGE: '@klo/cli-public',
            KLO_PUBLISHED_KLO_REGISTRY: 'file:///tmp/npm',
          },
          [],
        ),
      /KLO_PUBLISHED_KLO_REGISTRY must be an http\(s\) URL/,
    );
  });
});

describe('published package smoke command construction', () => {
  const config = {
    enabled: true,
    requireConfig: false,
    packageName: '@klo/cli-public',
    packageVersion: 'latest',
    registry: 'https://registry.npmjs.org/',
  };

  it('builds the npx package spec from package name and version tag', () => {
    assert.equal(publishedPackageSpec(config), '@klo/cli-public@latest');
  });

  it('builds npx commands with a registry env patch instead of shell interpolation', () => {
    assert.deepEqual(buildPublishedPackageNpxCommand(config, ['--version']), {
      label: 'published package command',
      command: 'npx',
      args: ['--yes', '@klo/cli-public@latest', '--version'],
      env: { npm_config_registry: 'https://registry.npmjs.org/' },
    });
  });

  it('builds the full hybrid-search smoke command list', () => {
    assert.deepEqual(buildPublishedPackageSmokeCommands(config, '/tmp/klo-smoke/demo', '/tmp/klo-smoke/empty'), [
      {
        label: 'published package version',
        command: 'npx',
        args: ['--yes', '@klo/cli-public@latest', '--version'],
        env: { npm_config_registry: 'https://registry.npmjs.org/' },
      },
      {
        label: 'published package demo',
        command: 'npx',
        args: [
          '--yes',
          '@klo/cli-public@latest',
          'demo',
          '--project-dir',
          '/tmp/klo-smoke/demo',
          '--no-input',
          '--plain',
        ],
        env: { npm_config_registry: 'https://registry.npmjs.org/' },
      },
      {
        label: 'published package wiki hybrid search',
        command: 'npx',
        args: [
          '--yes',
          '@klo/cli-public@latest',
          'agent',
          'wiki',
          'search',
          'ARR contract',
          '--json',
          '--limit',
          '5',
          '--project-dir',
          '/tmp/klo-smoke/demo',
        ],
        env: { npm_config_registry: 'https://registry.npmjs.org/' },
      },
      {
        label: 'published package semantic-layer hybrid search',
        command: 'npx',
        args: [
          '--yes',
          '@klo/cli-public@latest',
          'agent',
          'sl',
          'list',
          '--json',
          '--query',
          'ARR',
          '--project-dir',
          '/tmp/klo-smoke/demo',
        ],
        env: { npm_config_registry: 'https://registry.npmjs.org/' },
      },
      {
        label: 'published package missing-project readiness',
        command: 'npx',
        args: [
          '--yes',
          '@klo/cli-public@latest',
          'agent',
          'sl',
          'list',
          '--json',
          '--query',
          'revenue',
          '--project-dir',
          '/tmp/klo-smoke/empty',
        ],
        env: { npm_config_registry: 'https://registry.npmjs.org/' },
      },
    ]);
  });

  it('exposes the smoke through the package release script', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

    assert.equal(
      packageJson.scripts['release:published-smoke'],
      'node scripts/published-package-smoke.mjs --require-config',
    );
  });
});

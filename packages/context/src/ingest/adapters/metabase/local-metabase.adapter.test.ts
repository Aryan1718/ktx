import { describe, expect, it } from 'vitest';
import type { KloProjectConnectionConfig } from '../../../project/index.js';
import { metabaseRuntimeConfigFromLocalConnection } from './local-metabase.adapter.js';

describe('metabaseRuntimeConfigFromLocalConnection', () => {
  it('resolves api_url and env-backed api_key_ref from a flat klo.yaml connection', () => {
    const connection: KloProjectConnectionConfig = {
      driver: 'metabase',
      api_url: 'https://metabase.example.com',
      api_key_ref: 'env:METABASE_API_KEY', // pragma: allowlist secret
    };

    expect(
      metabaseRuntimeConfigFromLocalConnection('prod-metabase', connection, {
        METABASE_API_KEY: 'mb_key', // pragma: allowlist secret
      }),
    ).toEqual({
      apiUrl: 'https://metabase.example.com',
      apiKey: 'mb_key', // pragma: allowlist secret
    });
  });

  it('accepts url as the local api URL alias', () => {
    const connection: KloProjectConnectionConfig = {
      driver: 'metabase',
      url: 'https://metabase.example.com',
      api_key: 'literal-test-key', // pragma: allowlist secret
    };

    expect(metabaseRuntimeConfigFromLocalConnection('prod-metabase', connection)).toEqual({
      apiUrl: 'https://metabase.example.com',
      apiKey: 'literal-test-key', // pragma: allowlist secret
    });
  });

  it('rejects proxy-bearing local Metabase connections', () => {
    const connection: KloProjectConnectionConfig = {
      driver: 'metabase',
      api_url: 'https://metabase.example.com',
      api_key: 'literal-test-key', // pragma: allowlist secret
      networkProxy: { type: 'ssh' },
    };

    expect(() => metabaseRuntimeConfigFromLocalConnection('prod-metabase', connection)).toThrow(
      'Standalone KLO does not support proxy-bearing Metabase connections yet',
    );
  });

  it('rejects non-Metabase source connections', () => {
    const connection: KloProjectConnectionConfig = {
      driver: 'postgres',
      url: 'postgres://localhost/db',
    };

    expect(() => metabaseRuntimeConfigFromLocalConnection('warehouse', connection)).toThrow(
      'Connection "warehouse" is not a Metabase connection',
    );
  });
});

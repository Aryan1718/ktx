import { describe, expect, it } from 'vitest';
import { inferKloDimensionType, kloColumnTypeMappingFromNative, normalizeKloNativeType } from './type-normalization.js';

describe('KLO scan type normalization', () => {
  it('normalizes native database type strings', () => {
    expect(normalizeKloNativeType(' NUMERIC(12, 2) ')).toBe('numeric');
    expect(normalizeKloNativeType('TIMESTAMP WITH TIME ZONE')).toBe('timestamp with time zone');
    expect(normalizeKloNativeType('')).toBe('unknown');
  });

  it('infers dimension types from native types', () => {
    expect(inferKloDimensionType('BOOLEAN')).toBe('boolean');
    expect(inferKloDimensionType('timestamp with time zone')).toBe('time');
    expect(inferKloDimensionType('decimal(10,2)')).toBe('number');
    expect(inferKloDimensionType('varchar(255)')).toBe('string');
  });

  it('builds a complete column type mapping', () => {
    expect(kloColumnTypeMappingFromNative('BIGINT')).toEqual({
      normalizedType: 'bigint',
      dimensionType: 'number',
    });
  });
});

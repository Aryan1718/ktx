import type { KloSchemaDimensionType } from './types.js';

export interface KloColumnTypeMapping {
  normalizedType: string;
  dimensionType: KloSchemaDimensionType;
}

export function normalizeKloNativeType(nativeType: string): string {
  const normalized = nativeType.toLowerCase().replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : 'unknown';
}

export function inferKloDimensionType(nativeType: string): KloSchemaDimensionType {
  const normalized = normalizeKloNativeType(nativeType);
  if (/\b(bool|boolean)\b/.test(normalized)) {
    return 'boolean';
  }
  if (/\b(date|datetime|time|timestamp)\b/.test(normalized)) {
    return 'time';
  }
  if (/\b(int|integer|bigint|smallint|decimal|numeric|number|float|double|real)\b/.test(normalized)) {
    return 'number';
  }
  return 'string';
}

export function kloColumnTypeMappingFromNative(nativeType: string): KloColumnTypeMapping {
  return {
    normalizedType: normalizeKloNativeType(nativeType),
    dimensionType: inferKloDimensionType(nativeType),
  };
}

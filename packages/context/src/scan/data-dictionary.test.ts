import { describe, expect, it } from 'vitest';
import {
  defaultKloDataDictionarySettings,
  isKloDataDictionaryCandidate,
  shouldKloSampleColumnForDictionary,
} from './data-dictionary.js';

const defaultPatterns = defaultKloDataDictionarySettings.excludePatterns;

describe('KLO scan data dictionary policy', () => {
  it('includes text-like and boolean categorical types', () => {
    expect(isKloDataDictionaryCandidate('varchar(50)', 'status', defaultPatterns)).toBe(true);
    expect(isKloDataDictionaryCandidate('VARCHAR', 'category', defaultPatterns)).toBe(true);
    expect(isKloDataDictionaryCandidate('text', 'region', defaultPatterns)).toBe(true);
    expect(isKloDataDictionaryCandidate('string', 'payment_method', defaultPatterns)).toBe(true);
    expect(isKloDataDictionaryCandidate('nvarchar(100)', 'tier', defaultPatterns)).toBe(true);
    expect(isKloDataDictionaryCandidate('enum', 'status', defaultPatterns)).toBe(true);
    expect(isKloDataDictionaryCandidate('boolean', 'active', defaultPatterns)).toBe(true);
    expect(isKloDataDictionaryCandidate('bool', 'verified', defaultPatterns)).toBe(true);
    expect(isKloDataDictionaryCandidate('character varying(50)', 'region', defaultPatterns)).toBe(true);
    expect(isKloDataDictionaryCandidate('character(1)', 'flag', defaultPatterns)).toBe(true);
    expect(isKloDataDictionaryCandidate('ntext', 'category', defaultPatterns)).toBe(true);
  });

  it('excludes non-categorical primitive types', () => {
    expect(isKloDataDictionaryCandidate('integer', 'count', defaultPatterns)).toBe(false);
    expect(isKloDataDictionaryCandidate('bigint', 'total', defaultPatterns)).toBe(false);
    expect(isKloDataDictionaryCandidate('timestamp', 'created', defaultPatterns)).toBe(false);
    expect(isKloDataDictionaryCandidate('date', 'birth', defaultPatterns)).toBe(false);
    expect(isKloDataDictionaryCandidate('numeric', 'amount', defaultPatterns)).toBe(false);
    expect(isKloDataDictionaryCandidate('decimal(10,2)', 'price', defaultPatterns)).toBe(false);
    expect(isKloDataDictionaryCandidate('float', 'rate', defaultPatterns)).toBe(false);
  });

  it('excludes configured high-cardinality or sensitive name patterns', () => {
    expect(isKloDataDictionaryCandidate('varchar', 'user_id', defaultPatterns)).toBe(false);
    expect(isKloDataDictionaryCandidate('varchar', 'session_uuid', defaultPatterns)).toBe(false);
    expect(isKloDataDictionaryCandidate('varchar', 'api_key', defaultPatterns)).toBe(false);
    expect(isKloDataDictionaryCandidate('varchar', 'password_hash', defaultPatterns)).toBe(false);
    expect(isKloDataDictionaryCandidate('varchar', 'auth_token', defaultPatterns)).toBe(false);
    expect(isKloDataDictionaryCandidate('varchar', 'id', defaultPatterns)).toBe(false);
    expect(isKloDataDictionaryCandidate('varchar', 'created_at', defaultPatterns)).toBe(false);
    expect(isKloDataDictionaryCandidate('varchar', 'birth_date', defaultPatterns)).toBe(false);
    expect(isKloDataDictionaryCandidate('text', 'description', defaultPatterns)).toBe(false);
    expect(isKloDataDictionaryCandidate('text', 'email_body', defaultPatterns)).toBe(false);
    expect(isKloDataDictionaryCandidate('varchar', 'image_url', defaultPatterns)).toBe(false);
    expect(isKloDataDictionaryCandidate('varchar', 'email', defaultPatterns)).toBe(false);
    expect(isKloDataDictionaryCandidate('varchar', 'phone_number', defaultPatterns)).toBe(false);
    expect(isKloDataDictionaryCandidate('varchar', 'street_address', defaultPatterns)).toBe(false);
  });

  it('keeps business categorical names eligible', () => {
    expect(isKloDataDictionaryCandidate('varchar', 'status', defaultPatterns)).toBe(true);
    expect(isKloDataDictionaryCandidate('varchar', 'region', defaultPatterns)).toBe(true);
    expect(isKloDataDictionaryCandidate('varchar', 'country', defaultPatterns)).toBe(true);
    expect(isKloDataDictionaryCandidate('varchar', 'payment_method', defaultPatterns)).toBe(true);
    expect(isKloDataDictionaryCandidate('varchar', 'currency', defaultPatterns)).toBe(true);
    expect(isKloDataDictionaryCandidate('varchar', 'plan', defaultPatterns)).toBe(true);
    expect(isKloDataDictionaryCandidate('varchar', 'category', defaultPatterns)).toBe(true);
    expect(isKloDataDictionaryCandidate('varchar', 'tier', defaultPatterns)).toBe(true);
    expect(isKloDataDictionaryCandidate('varchar', 'gender', defaultPatterns)).toBe(true);
    expect(isKloDataDictionaryCandidate('varchar', 'language', defaultPatterns)).toBe(true);
    expect(isKloDataDictionaryCandidate('varchar', 'order_type', defaultPatterns)).toBe(true);
    expect(isKloDataDictionaryCandidate('varchar', 'order_status', defaultPatterns)).toBe(true);
  });

  it('respects host-provided exclusion patterns and skips invalid regex patterns', () => {
    expect(isKloDataDictionaryCandidate('varchar', 'company_size', ['company'])).toBe(false);
    expect(isKloDataDictionaryCandidate('varchar', 'status', ['company'])).toBe(true);
    expect(isKloDataDictionaryCandidate('varchar', 'status', ['[invalid', '(unclosed'])).toBe(true);
  });

  it('skips columns that already have persisted dictionary state', () => {
    expect(
      shouldKloSampleColumnForDictionary({
        columnType: 'varchar',
        columnName: 'status',
        sampleValues: ['paid'],
        cardinality: null,
        settings: defaultKloDataDictionarySettings,
      }),
    ).toEqual({ sample: false, reason: 'already_populated' });

    expect(
      shouldKloSampleColumnForDictionary({
        columnType: 'varchar',
        columnName: 'empty_status',
        sampleValues: null,
        cardinality: 0,
        settings: defaultKloDataDictionarySettings,
      }),
    ).toEqual({ sample: false, reason: 'empty_column' });

    expect(
      shouldKloSampleColumnForDictionary({
        columnType: 'varchar',
        columnName: 'customer_name',
        sampleValues: null,
        cardinality: 300,
        settings: defaultKloDataDictionarySettings,
      }),
    ).toEqual({ sample: false, reason: 'high_cardinality' });

    expect(
      shouldKloSampleColumnForDictionary({
        columnType: 'varchar',
        columnName: 'status',
        sampleValues: null,
        cardinality: null,
        settings: defaultKloDataDictionarySettings,
      }),
    ).toEqual({ sample: true });
  });
});

export interface KloDataDictionarySettings {
  cardinalityThreshold: number;
  maxValuesToStore: number;
  sampleSize: number;
  useDbStatistics: boolean;
  excludePatterns: string[];
}

export const defaultKloDataDictionarySettings: KloDataDictionarySettings = {
  cardinalityThreshold: 200,
  maxValuesToStore: 100,
  sampleSize: 10000,
  useDbStatistics: true,
  excludePatterns: [
    '_id$',
    '_uuid$',
    '_key$',
    '_hash$',
    '_token$',
    '^id$',
    '^uuid$',
    '_at$',
    '_date$',
    '_time$',
    'description$',
    'comment$',
    'notes?$',
    'message$',
    'body$',
    'content$',
    '_url$',
    '_path$',
    'email$',
    '^phone',
    'address$',
  ],
};

export type KloDataDictionarySkipReason =
  | 'not_candidate'
  | 'already_populated'
  | 'empty_column'
  | 'high_cardinality';

export interface KloDataDictionarySampleDecision {
  sample: boolean;
  reason?: KloDataDictionarySkipReason;
}

export interface KloDataDictionaryColumnState {
  columnType: string;
  columnName: string;
  sampleValues?: readonly string[] | null;
  cardinality?: number | null;
  settings: KloDataDictionarySettings;
}

const categoricalCandidateTypes = /^(n?varchar|n?char|n?text|string|character|enum|bool(ean)?)/i;

export function isKloDataDictionaryCandidate(
  columnType: string,
  columnName: string,
  excludePatterns: readonly string[] = defaultKloDataDictionarySettings.excludePatterns,
): boolean {
  const typeLower = columnType.toLowerCase();
  const nameLower = columnName.toLowerCase();

  if (!categoricalCandidateTypes.test(typeLower)) {
    return false;
  }

  for (const patternText of excludePatterns) {
    try {
      const pattern = new RegExp(patternText, 'i');
      if (pattern.test(nameLower)) {
        return false;
      }
    } catch {
      continue;
    }
  }

  return true;
}

export function shouldKloSampleColumnForDictionary(
  input: KloDataDictionaryColumnState,
): KloDataDictionarySampleDecision {
  const sampleValues = input.sampleValues ?? null;
  const cardinality = input.cardinality ?? null;

  if (sampleValues && sampleValues.length > 0) {
    return { sample: false, reason: 'already_populated' };
  }

  if (cardinality === 0) {
    return { sample: false, reason: 'empty_column' };
  }

  if (cardinality !== null && cardinality > input.settings.cardinalityThreshold) {
    return { sample: false, reason: 'high_cardinality' };
  }

  if (!isKloDataDictionaryCandidate(input.columnType, input.columnName, input.settings.excludePatterns)) {
    return { sample: false, reason: 'not_candidate' };
  }

  return { sample: true };
}

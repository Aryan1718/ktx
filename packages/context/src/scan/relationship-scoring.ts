export const KLO_RELATIONSHIP_SCORE_SIGNAL_KEYS = [
  'nameSimilarity',
  'typeCompatibility',
  'valueOverlap',
  'embeddingSimilarity',
  'profileUniqueness',
  'profileNullRate',
  'structuralPrior',
] as const;

export type KloRelationshipScoreSignal = (typeof KLO_RELATIONSHIP_SCORE_SIGNAL_KEYS)[number];

export type KloRelationshipFixtureOrigin = 'synthetic' | 'public' | 'customer';

export interface KloRelationshipSignalVector {
  nameSimilarity: number;
  typeCompatibility: number;
  valueOverlap: number;
  embeddingSimilarity: number;
  profileUniqueness: number;
  profileNullRate: number;
  structuralPrior: number;
}

export type KloRelationshipScoreWeights = Record<KloRelationshipScoreSignal, number>;

export interface KloRelationshipScoreBreakdown {
  score: number;
  signals: KloRelationshipSignalVector;
  weights: KloRelationshipScoreWeights;
  contributions: KloRelationshipScoreWeights;
}

export interface KloRelationshipScoringCalibrationObservation {
  fixtureId: string;
  origin: KloRelationshipFixtureOrigin;
  expectedRelationship: boolean;
  signals: KloRelationshipSignalVector;
}

const DEFAULT_WEIGHTS: KloRelationshipScoreWeights = {
  nameSimilarity: 0.24,
  typeCompatibility: 0.1,
  valueOverlap: 0.22,
  embeddingSimilarity: 0.1,
  profileUniqueness: 0.22,
  profileNullRate: 0.08,
  structuralPrior: 0.04,
};

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function roundScore(value: number): number {
  return Number(clampScore(value).toFixed(3));
}

function sanitizeSignalVector(signals: KloRelationshipSignalVector): KloRelationshipSignalVector {
  return {
    nameSimilarity: roundScore(signals.nameSimilarity),
    typeCompatibility: roundScore(signals.typeCompatibility),
    valueOverlap: roundScore(signals.valueOverlap),
    embeddingSimilarity: roundScore(signals.embeddingSimilarity),
    profileUniqueness: roundScore(signals.profileUniqueness),
    profileNullRate: roundScore(signals.profileNullRate),
    structuralPrior: roundScore(signals.structuralPrior),
  };
}

export function defaultKloRelationshipScoreWeights(): KloRelationshipScoreWeights {
  return { ...DEFAULT_WEIGHTS };
}

export function normalizeKloRelationshipScoreWeights(
  weights: Partial<KloRelationshipScoreWeights> = DEFAULT_WEIGHTS,
): KloRelationshipScoreWeights {
  const rawEntries = KLO_RELATIONSHIP_SCORE_SIGNAL_KEYS.map((key) => {
    const value = weights[key] ?? 0;
    return [key, Number.isFinite(value) ? Math.max(0, value) : 0] as const;
  });
  const total = rawEntries.reduce((sum, [, value]) => sum + value, 0);
  if (total <= 0) {
    return defaultKloRelationshipScoreWeights();
  }

  return Object.fromEntries(rawEntries.map(([key, value]) => [key, value / total])) as KloRelationshipScoreWeights;
}

export function scoreKloRelationshipCandidate(
  signals: KloRelationshipSignalVector,
  weights: Partial<KloRelationshipScoreWeights> = DEFAULT_WEIGHTS,
): KloRelationshipScoreBreakdown {
  const sanitizedSignals = sanitizeSignalVector(signals);
  const normalizedWeights = normalizeKloRelationshipScoreWeights(weights);
  const contributions = Object.fromEntries(
    KLO_RELATIONSHIP_SCORE_SIGNAL_KEYS.map((key) => [
      key,
      Number((sanitizedSignals[key] * normalizedWeights[key]).toFixed(6)),
    ]),
  ) as KloRelationshipScoreWeights;
  const rawWeightedScore = KLO_RELATIONSHIP_SCORE_SIGNAL_KEYS.reduce((sum, key) => sum + contributions[key], 0);
  const scoredConfidence = sanitizedSignals.typeCompatibility <= 0 ? 0 : 0.56 + rawWeightedScore * 0.65;

  return {
    score: roundScore(scoredConfidence),
    signals: sanitizedSignals,
    weights: normalizedWeights,
    contributions,
  };
}

function averageSignal(
  observations: readonly KloRelationshipScoringCalibrationObservation[],
  key: KloRelationshipScoreSignal,
): number {
  if (observations.length === 0) {
    return 0;
  }
  return observations.reduce((sum, observation) => sum + clampScore(observation.signals[key]), 0) / observations.length;
}

export function calibrateWeightsFromSyntheticFixtures(
  observations: readonly KloRelationshipScoringCalibrationObservation[],
): KloRelationshipScoreWeights {
  const nonSynthetic = observations.find((observation) => observation.origin !== 'synthetic');
  if (nonSynthetic) {
    throw new Error(
      `Relationship score calibration accepts only synthetic fixtures; ${nonSynthetic.fixtureId} is ${nonSynthetic.origin}`,
    );
  }
  if (observations.length === 0) {
    return defaultKloRelationshipScoreWeights();
  }

  const positives = observations.filter((observation) => observation.expectedRelationship);
  const negatives = observations.filter((observation) => !observation.expectedRelationship);
  if (positives.length === 0 || negatives.length === 0) {
    return defaultKloRelationshipScoreWeights();
  }

  const calibrated = Object.fromEntries(
    KLO_RELATIONSHIP_SCORE_SIGNAL_KEYS.map((key) => {
      const positiveAverage = averageSignal(positives, key);
      const negativeAverage = averageSignal(negatives, key);
      const separation = Math.max(0, positiveAverage - negativeAverage);
      return [key, separation + DEFAULT_WEIGHTS[key] * 0.25];
    }),
  ) as KloRelationshipScoreWeights;

  return normalizeKloRelationshipScoreWeights(calibrated);
}

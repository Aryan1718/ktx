export type KloRelationshipValidationBudget = number | 'all' | undefined;

export interface KloRelationshipBudgetedCandidate<TCandidate> {
  candidate: TCandidate;
  originalIndex: number;
  score: number;
}

export interface KloRelationshipValidationBudgetResult<TCandidate> {
  effectiveBudget: number | 'all';
  toValidate: KloRelationshipBudgetedCandidate<TCandidate>[];
  deferred: KloRelationshipBudgetedCandidate<TCandidate>[];
}

export interface ApplyKloRelationshipValidationBudgetInput<TCandidate> {
  candidates: readonly TCandidate[];
  tableCount: number;
  budget?: KloRelationshipValidationBudget;
  score: (candidate: TCandidate) => number;
}

export function defaultKloRelationshipValidationBudget(tableCount: number): number {
  const safeTableCount = Number.isFinite(tableCount) ? Math.max(0, Math.floor(tableCount)) : 0;
  return Math.min(2 * safeTableCount, 1000);
}

export function applyKloRelationshipValidationBudget<TCandidate>(
  input: ApplyKloRelationshipValidationBudgetInput<TCandidate>,
): KloRelationshipValidationBudgetResult<TCandidate> {
  const ranked = input.candidates
    .map((candidate, originalIndex) => ({
      candidate,
      originalIndex,
      score: input.score(candidate),
    }))
    .sort((left, right) => {
      const scoreDelta = right.score - left.score;
      return scoreDelta === 0 ? left.originalIndex - right.originalIndex : scoreDelta;
    });

  if (input.budget === 'all') {
    return {
      effectiveBudget: 'all',
      toValidate: input.candidates.map((candidate, originalIndex) => ({
        candidate,
        originalIndex,
        score: input.score(candidate),
      })),
      deferred: [],
    };
  }

  const effectiveBudget = input.budget ?? defaultKloRelationshipValidationBudget(input.tableCount);
  const safeBudget = Math.max(0, Math.floor(effectiveBudget));
  return {
    effectiveBudget: safeBudget,
    toValidate: ranked.slice(0, safeBudget),
    deferred: ranked.slice(safeBudget),
  };
}

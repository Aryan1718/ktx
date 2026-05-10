import { isKloRelationshipBenchmarkTuningEligible } from './relationship-benchmarks.js';
import type {
  KloRelationshipBenchmarkCaseResult,
  KloRelationshipBenchmarkFixture,
  KloRelationshipBenchmarkMode,
  KloRelationshipBenchmarkSuiteResult,
} from './relationship-benchmarks.js';

export type KloRelationshipBenchmarkReportCaseStatus = 'run' | 'validation_blocked' | 'not_run';

export interface KloRelationshipBenchmarkReportCase {
  fixtureId: string;
  fixtureName: string;
  tier: string;
  mode: KloRelationshipBenchmarkMode;
  status: KloRelationshipBenchmarkReportCaseStatus;
  reason: string | null;
  tuningEligible: boolean;
  metrics: {
    pkRecall: number | null;
    fkRecall: number | null;
    acceptedOrReviewRecall: number | null;
    acceptedFalsePositiveCount: number | null;
    sqlQueries: number | null;
    llmCalls: number | null;
    runtimeSeconds: number | null;
  };
  falsePositives: {
    pk: string[];
    fk: string[];
  };
  falseNegatives: {
    pk: string[];
    fk: string[];
  };
  skippedComposite: {
    pk: string[];
    fk: string[];
  };
}

export interface KloRelationshipBenchmarkReport {
  generatedAt: string;
  headline: {
    caseCount: number;
    headlineCaseCount: number;
    headlinePkRecall: number;
    headlineFkRecall: number;
    headlineAcceptedOrReviewRecall: number;
    acceptedFalsePositiveCount: number;
    validationBlockedCount: number;
  };
  cases: KloRelationshipBenchmarkReportCase[];
}

function key(fixtureId: string, mode: KloRelationshipBenchmarkMode): string {
  return `${fixtureId}:${mode}`;
}

function fixed(value: number | null): string {
  return value === null ? '-' : value.toFixed(3);
}

function reportCaseReason(input: {
  fixture: KloRelationshipBenchmarkFixture;
  result: KloRelationshipBenchmarkCaseResult;
}): string | null {
  if (input.result.validationBlocked) {
    return 'validation unavailable for this benchmark mode';
  }

  if (input.fixture.validationBudget !== undefined && input.result.predicted.reviewFk.length > 0) {
    return `review candidate validation reasons: validation_unattempted (${input.result.predicted.reviewFk.length})`;
  }

  return null;
}

function reportCaseFromResult(input: {
  fixture: KloRelationshipBenchmarkFixture;
  mode: KloRelationshipBenchmarkMode;
  result: KloRelationshipBenchmarkCaseResult;
}): KloRelationshipBenchmarkReportCase {
  const status = input.result.validationBlocked ? 'validation_blocked' : 'run';
  return {
    fixtureId: input.fixture.id,
    fixtureName: input.fixture.name,
    tier: input.fixture.tier,
    mode: input.mode,
    status,
    reason: reportCaseReason({ fixture: input.fixture, result: input.result }),
    tuningEligible: isKloRelationshipBenchmarkTuningEligible({
      fixture: input.fixture,
      mode: input.mode,
      validationBlocked: input.result.validationBlocked,
    }),
    metrics: {
      pkRecall: input.result.metrics.pkRecall,
      fkRecall: input.result.metrics.fkRecall,
      acceptedOrReviewRecall: input.result.metrics.acceptedOrReviewRecall,
      acceptedFalsePositiveCount: input.result.metrics.acceptedFalsePositiveCount,
      sqlQueries: input.result.metrics.sqlQueries,
      llmCalls: input.result.metrics.llmCalls,
      runtimeSeconds: input.result.metrics.runtimeSeconds,
    },
    falsePositives: input.result.falsePositives,
    falseNegatives: input.result.falseNegatives,
    skippedComposite: input.result.skippedComposite,
  };
}

function notRunCase(input: {
  fixture: KloRelationshipBenchmarkFixture;
  mode: KloRelationshipBenchmarkMode;
  reason: string;
}): KloRelationshipBenchmarkReportCase {
  return {
    fixtureId: input.fixture.id,
    fixtureName: input.fixture.name,
    tier: input.fixture.tier,
    mode: input.mode,
    status: 'not_run',
    reason: input.reason,
    tuningEligible: false,
    metrics: {
      pkRecall: null,
      fkRecall: null,
      acceptedOrReviewRecall: null,
      acceptedFalsePositiveCount: null,
      sqlQueries: null,
      llmCalls: null,
      runtimeSeconds: null,
    },
    falsePositives: { pk: [], fk: [] },
    falseNegatives: { pk: [], fk: [] },
    skippedComposite: { pk: [], fk: [] },
  };
}

export function buildKloRelationshipBenchmarkReport(input: {
  fixtures: readonly KloRelationshipBenchmarkFixture[];
  suite: KloRelationshipBenchmarkSuiteResult;
  modes: readonly KloRelationshipBenchmarkMode[];
  generatedAt?: string;
}): KloRelationshipBenchmarkReport {
  const resultsByKey = new Map(input.suite.cases.map((result) => [key(result.fixtureId, result.mode), result]));
  const cases: KloRelationshipBenchmarkReportCase[] = [];

  for (const fixture of input.fixtures) {
    const selectedModes = new Set(fixture.defaultModes);
    for (const mode of input.modes) {
      const result = resultsByKey.get(key(fixture.id, mode));
      if (result) {
        cases.push(reportCaseFromResult({ fixture, mode, result }));
        continue;
      }
      cases.push(
        notRunCase({
          fixture,
          mode,
          reason: selectedModes.has(mode) ? 'mode produced no benchmark result' : 'mode not selected by fixture defaultModes',
        }),
      );
    }
  }

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    headline: {
      caseCount: input.suite.aggregate.caseCount,
      headlineCaseCount: input.suite.aggregate.headlineCaseCount,
      headlinePkRecall: input.suite.aggregate.headlinePkRecall,
      headlineFkRecall: input.suite.aggregate.headlineFkRecall,
      headlineAcceptedOrReviewRecall: input.suite.aggregate.headlineAcceptedOrReviewRecall,
      acceptedFalsePositiveCount: input.suite.cases.reduce(
        (sum, result) => sum + result.metrics.acceptedFalsePositiveCount,
        0,
      ),
      validationBlockedCount: input.suite.validationBlockedCases.length,
    },
    cases,
  };
}

type KloRelationshipBenchmarkFailureSelector = (
  item: KloRelationshipBenchmarkReportCase,
) => readonly string[];

function sortedFailureLines(input: {
  cases: readonly KloRelationshipBenchmarkReportCase[];
  select: KloRelationshipBenchmarkFailureSelector;
}): string[] {
  return input.cases
    .flatMap((item) =>
      input.select(item).map((value) => ({
        fixtureId: item.fixtureId,
        mode: item.mode,
        status: item.status,
        value,
      })),
    )
    .sort((left, right) => {
      const leftKey = `${left.fixtureId}:${left.mode}:${left.status}:${left.value}`;
      const rightKey = `${right.fixtureId}:${right.mode}:${right.status}:${right.value}`;
      return leftKey.localeCompare(rightKey);
    })
    .map((item) => `- \`${item.fixtureId}\` / \`${item.mode}\` / \`${item.status}\`: ${item.value}`);
}

function failureBlock(input: {
  title: string;
  cases: readonly KloRelationshipBenchmarkReportCase[];
  select: KloRelationshipBenchmarkFailureSelector;
}): string[] {
  const values = sortedFailureLines({ cases: input.cases, select: input.select });
  return ['', `### ${input.title}`, '', ...(values.length > 0 ? values : ['- none'])];
}

function headlineFailureContextBlocks(report: KloRelationshipBenchmarkReport): string[] {
  const headlineCases = report.cases.filter((item) => item.tuningEligible);
  const remainingPkMisses = sortedFailureLines({
    cases: headlineCases,
    select: (item) => item.falseNegatives.pk,
  });
  const remainingFkMisses = sortedFailureLines({
    cases: headlineCases,
    select: (item) => item.falseNegatives.fk,
  });

  return [
    '',
    '## Headline Failure Context',
    '',
    'Remaining headline misses after this run are listed here so recall gains and still-open algorithmic gaps are visible in the regenerated evidence report.',
    '',
    `- Remaining headline false-negative PKs: ${remainingPkMisses.length}`,
    `- Remaining headline false-negative FKs: ${remainingFkMisses.length}`,
    '',
    '### Remaining Headline False Negative PKs',
    '',
    ...(remainingPkMisses.length > 0 ? remainingPkMisses : ['- none']),
    '',
    '### Remaining Headline False Negative FKs',
    '',
    ...(remainingFkMisses.length > 0 ? remainingFkMisses : ['- none']),
  ];
}

function failureDetailBlocks(report: KloRelationshipBenchmarkReport): string[] {
  const headlineCases = report.cases.filter((item) => item.tuningEligible);
  const otherCases = report.cases.filter((item) => !item.tuningEligible);

  return [
    '',
    '## Failure Details',
    ...failureBlock({
      title: 'Headline False Positive PKs',
      cases: headlineCases,
      select: (item) => item.falsePositives.pk,
    }),
    ...failureBlock({
      title: 'Headline False Positive FKs',
      cases: headlineCases,
      select: (item) => item.falsePositives.fk,
    }),
    ...failureBlock({
      title: 'Headline False Negative PKs',
      cases: headlineCases,
      select: (item) => item.falseNegatives.pk,
    }),
    ...failureBlock({
      title: 'Headline False Negative FKs',
      cases: headlineCases,
      select: (item) => item.falseNegatives.fk,
    }),
    ...failureBlock({
      title: 'Other False Positive PKs',
      cases: otherCases,
      select: (item) => item.falsePositives.pk,
    }),
    ...failureBlock({
      title: 'Other False Positive FKs',
      cases: otherCases,
      select: (item) => item.falsePositives.fk,
    }),
    ...failureBlock({
      title: 'Other False Negative PKs',
      cases: otherCases,
      select: (item) => item.falseNegatives.pk,
    }),
    ...failureBlock({
      title: 'Other False Negative FKs',
      cases: otherCases,
      select: (item) => item.falseNegatives.fk,
    }),
  ];
}

function compositeSkipBlocks(report: KloRelationshipBenchmarkReport): string[] {
  const headlineCases = report.cases.filter((item) => item.tuningEligible);

  return [
    '',
    '## Composite Ground Truth Skips',
    ...failureBlock({
      title: 'Skipped Composite PKs',
      cases: headlineCases,
      select: (item) => item.skippedComposite.pk,
    }),
    ...failureBlock({
      title: 'Skipped Composite FKs',
      cases: headlineCases,
      select: (item) => item.skippedComposite.fk,
    }),
  ];
}

export function formatKloRelationshipBenchmarkReportMarkdown(report: KloRelationshipBenchmarkReport): string {
  const lines = [
    '# KLO Relationship Discovery Benchmark Evidence',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Headline',
    '',
    `- Cases run: ${report.headline.caseCount}`,
    `- Headline cases: ${report.headline.headlineCaseCount}`,
    `- Headline PK recall: ${fixed(report.headline.headlinePkRecall)}`,
    `- Headline FK recall: ${fixed(report.headline.headlineFkRecall)}`,
    `- Headline accepted-or-review recall: ${fixed(report.headline.headlineAcceptedOrReviewRecall)}`,
    `- Accepted false positives: ${report.headline.acceptedFalsePositiveCount}`,
    `- Validation-blocked cases: ${report.headline.validationBlockedCount}`,
    '',
    '## Cases',
    '',
    '| Fixture | Tier | Mode | Status | Tuning Eligible | PK Recall | FK Recall | Accepted+Review Recall | Accepted FP | Reason |',
    '| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |',
  ];

  for (const item of report.cases) {
    lines.push(
      [
        `| ${item.fixtureId}`,
        item.tier,
        item.mode,
        item.status,
        item.tuningEligible ? 'yes' : 'no',
        fixed(item.metrics.pkRecall),
        fixed(item.metrics.fkRecall),
        fixed(item.metrics.acceptedOrReviewRecall),
        String(item.metrics.acceptedFalsePositiveCount ?? '-'),
        `${item.reason ?? ''} |`,
      ].join(' | '),
    );
  }

  lines.push(...headlineFailureContextBlocks(report));
  lines.push(...failureDetailBlocks(report));
  lines.push(...compositeSkipBlocks(report));
  lines.push('');

  return `${lines.join('\n')}\n`;
}

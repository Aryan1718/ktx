import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KLO_RELATIONSHIP_BENCHMARK_MODES,
  buildKloRelationshipBenchmarkReport,
  currentKloRelationshipBenchmarkDetector,
  formatKloRelationshipBenchmarkReportMarkdown,
  kloRelationshipBenchmarkDetectorWithLlm,
  loadKloRelationshipBenchmarkFixtures,
  runKloRelationshipBenchmarkSuite,
} from '../dist/scan/index.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, '..');
const fixtureRoot = join(packageRoot, 'test/fixtures/relationship-benchmarks');

async function buildDetector() {
  const backend = process.env.KLO_BENCHMARK_LLM_BACKEND;
  if (!backend || backend === 'none') {
    return currentKloRelationshipBenchmarkDetector();
  }
  if (backend !== 'vertex') {
    throw new Error(`Unsupported KLO_BENCHMARK_LLM_BACKEND: ${backend}`);
  }
  const project = process.env.KLO_BENCHMARK_VERTEX_PROJECT;
  const location = process.env.KLO_BENCHMARK_VERTEX_LOCATION;
  const model = process.env.KLO_BENCHMARK_LLM_MODEL ?? 'claude-sonnet-4-6';
  if (!project || !location) {
    throw new Error('KLO_BENCHMARK_VERTEX_PROJECT and KLO_BENCHMARK_VERTEX_LOCATION are required for vertex backend');
  }
  const { createKloLlmProvider } = await import('@klo/llm');
  const provider = createKloLlmProvider({
    backend: 'vertex',
    vertex: { project, location },
    modelSlots: { default: model },
  });
  return kloRelationshipBenchmarkDetectorWithLlm(provider);
}

const fixtures = await loadKloRelationshipBenchmarkFixtures(fixtureRoot);
const detector = await buildDetector();
const suite = await runKloRelationshipBenchmarkSuite({
  fixtures,
  detector,
});
const report = buildKloRelationshipBenchmarkReport({
  fixtures,
  suite,
  modes: KLO_RELATIONSHIP_BENCHMARK_MODES,
});

process.stdout.write(formatKloRelationshipBenchmarkReportMarkdown(report));

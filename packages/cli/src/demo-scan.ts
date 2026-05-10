import { getLocalIngestStatus, type IngestReportSnapshot, type MemoryFlowReplayInput } from '@klo/context/ingest';
import { loadKloProject, type KloLocalProject } from '@klo/context/project';
import { runLocalScan, type KloScanReport, type LocalScanRunResult } from '@klo/context/scan';
import { DEMO_ADAPTER, DEMO_CONNECTION_ID, DEMO_FULL_JOB_ID, ensureDemoProject } from './demo-assets.js';
import { loadLatestDemoReplay } from './demo-replay-store.js';
import { createKloCliLocalIngestAdapters } from './local-adapters.js';

interface DemoScanOptions {
  projectDir: string;
  jobId?: string;
  now?: () => Date;
  runLocalScan?: typeof runLocalScan;
}

interface DemoScanResult {
  project: KloLocalProject;
  result: LocalScanRunResult;
}

interface DemoInspectSummary {
  projectDir: string;
  scanReport: KloScanReport | null;
  fullReport: IngestReportSnapshot | null;
  semanticLayerFileCount: number;
  knowledgeFileCount: number;
  replayFileCount: number;
  latestReplay: MemoryFlowReplayInput | null;
}

interface DemoInspectDeps {
  findFullReport?: (project: KloLocalProject) => Promise<IngestReportSnapshot | null>;
}

async function ensureDemoProjectForReuse(projectDir: string): Promise<void> {
  await ensureDemoProject({ projectDir, force: false }).catch((error) => {
    if (error instanceof Error && error.message.includes('Demo project already exists')) {
      return;
    }
    throw error;
  });
}

async function loadReadyDemoProject(projectDir: string): Promise<KloLocalProject> {
  try {
    return await loadKloProject({ projectDir });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Demo project is not ready at ${projectDir}: ${reason}. Run klo setup demo init --project-dir ${projectDir} --force --no-input to recreate it.`,
    );
  }
}

function reportDiff(report: KloScanReport): string {
  return `+${report.diffSummary.tablesAdded}/~${report.diffSummary.tablesModified}/-${report.diffSummary.tablesDeleted}/=${report.diffSummary.tablesUnchanged}`;
}

function jsonReport(raw: string, path: string): KloScanReport {
  try {
    return JSON.parse(raw) as KloScanReport;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid demo scan report at ${path}: ${reason}`);
  }
}

async function countFiles(project: KloLocalProject, root: string, predicate: (path: string) => boolean): Promise<number> {
  const { files } = await project.fileStore.listFiles(root, true);
  return files.filter(predicate).length;
}

async function findFullDemoReport(project: KloLocalProject): Promise<IngestReportSnapshot | null> {
  return getLocalIngestStatus(project, DEMO_FULL_JOB_ID);
}

function savedCounts(report: IngestReportSnapshot): { wikiCount: number; slCount: number } {
  const actions = report.body.workUnits.flatMap((workUnit) => workUnit.actions);
  return {
    wikiCount: actions.filter((action) => action.target === 'wiki').length,
    slCount: actions.filter((action) => action.target === 'sl').length,
  };
}

export async function runDemoScan(options: DemoScanOptions): Promise<DemoScanResult> {
  await ensureDemoProjectForReuse(options.projectDir);
  const project = await loadReadyDemoProject(options.projectDir);
  const executeScan = options.runLocalScan ?? runLocalScan;
  const result = await executeScan({
    project,
    connectionId: DEMO_CONNECTION_ID,
    mode: 'structural',
    trigger: 'cli',
    jobId: options.jobId ?? 'demo-scan',
    now: options.now,
    adapters: createKloCliLocalIngestAdapters(project),
  });

  return { project, result };
}

export async function findLatestDemoScanReport(projectDir: string): Promise<KloScanReport | null> {
  const project = await loadReadyDemoProject(projectDir);
  const root = `raw-sources/${DEMO_CONNECTION_ID}/${DEMO_ADAPTER}`;
  const { files } = await project.fileStore.listFiles(root, true);
  const latest = files
    .filter((path) => path.endsWith('/scan-report.json'))
    .sort()
    .at(-1);
  if (!latest) {
    return null;
  }

  const reportPath = `${root}/${latest}`;
  const report = await project.fileStore.readFile(reportPath);
  return jsonReport(report.content, reportPath);
}

export async function inspectDemoProject(
  projectDir: string,
  projectOverride?: KloLocalProject,
  deps: DemoInspectDeps = {},
): Promise<DemoInspectSummary> {
  const project = projectOverride ?? (await loadReadyDemoProject(projectDir));
  const scanReport = await findLatestDemoScanReport(project.projectDir);
  const fullReport = await (deps.findFullReport ?? findFullDemoReport)(project);
  const semanticLayerFileCount = await countFiles(
    project,
    `semantic-layer/${DEMO_CONNECTION_ID}`,
    (path) => path.endsWith('.yaml') || path.endsWith('.yml'),
  );
  const knowledgeFileCount = await countFiles(project, 'knowledge', (path) => path.endsWith('.md'));
  const replayFileCount = await countFiles(project, 'replays', (path) => path.endsWith('.json'));
  const latestReplay = await loadLatestDemoReplay(project.projectDir);

  return {
    projectDir: project.projectDir,
    scanReport,
    fullReport,
    semanticLayerFileCount,
    knowledgeFileCount,
    replayFileCount,
    latestReplay,
  };
}

export function formatDemoScanSummary(report: KloScanReport): string {
  return [
    'Demo scan: done',
    `Connection: ${report.connectionId}`,
    `Driver: ${report.driver}`,
    `Mode: ${report.mode}`,
    `Tables: ${reportDiff(report)}`,
    `Semantic-layer artifacts: ${report.artifactPaths.manifestShards.length}`,
    `Report: ${report.artifactPaths.reportPath ?? 'none'}`,
    'Next: klo setup demo inspect',
    '  Shows the files and semantic-layer draft created from the database scan.',
    '',
  ].join('\n');
}

function replayLine(replay: MemoryFlowReplayInput | null): string {
  if (!replay?.metadata) {
    return 'Latest replay: packaged demo replay';
  }
  return `Latest replay: ${replay.metadata.mode} (${replay.metadata.origin}, ${replay.metadata.timing})`;
}

export function formatDemoInspect(summary: DemoInspectSummary): string {
  const report = summary.scanReport;
  const fullReport = summary.fullReport;
  const fullCounts = fullReport ? savedCounts(fullReport) : null;
  const scanLines = report
    ? [
        'Scan artifacts: yes',
        `Connection: ${report.connectionId}`,
        `Driver: ${report.driver}`,
        `Tables: ${reportDiff(report)}`,
        `Report: ${report.artifactPaths.reportPath ?? 'none'}`,
      ]
    : ['Scan artifacts: none'];

  const memoryLines = fullReport
    ? [
        'Memory synthesis: ran',
        `Full report: ${fullReport.id}`,
        `Full run: ${fullReport.runId}`,
        `Saved memory: ${fullCounts?.wikiCount ?? 0} wiki, ${fullCounts?.slCount ?? 0} semantic layer`,
        `Provenance rows: ${fullReport.body.provenanceRows.length}`,
      ]
    : [report ? 'Memory synthesis: full mode not run' : 'Memory synthesis: not run'];
  const next = fullReport
    ? [
        `Next: klo ingest watch ${fullReport.runId} --project-dir ${summary.projectDir}`,
        '  Opens the captured run timeline and lets you inspect what happened.',
        'Next: klo setup demo replay',
        '  Replays the same visual story without calling the LLM again.',
      ]
    : report
      ? [
          'Next: klo setup demo --mode full',
          '  Runs the full AI-backed pass with your LLM provider.',
          'Next: klo setup demo replay',
          '  Replays the packaged visual story without calling the LLM.',
        ]
      : [
          'Next: klo setup demo --no-input',
          '  Runs the pre-seeded demo without calling the LLM.',
          'Next: klo setup demo --mode full',
          '  Runs the full AI-backed pass with your LLM provider.',
        ];

  return [
    `Demo project: ${summary.projectDir}`,
    ...scanLines,
    `Semantic-layer files: ${summary.semanticLayerFileCount}`,
    `Knowledge files: ${summary.knowledgeFileCount}`,
    `Replay files: ${summary.replayFileCount}`,
    replayLine(summary.latestReplay),
    ...memoryLines,
    ...next,
    '',
  ].join('\n');
}

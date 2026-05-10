import type { KloLocalProject } from '../project/index.js';
import { getLocalScanReport } from './local-scan.js';
import type { KloRelationshipArtifact, KloRelationshipDiagnosticsArtifact } from './relationship-diagnostics.js';
import type { KloRelationshipProfileArtifact } from './relationship-profiling.js';
import type { KloScanReport } from './types.js';

export type KloRelationshipArtifactStatus = 'accepted' | 'review' | 'rejected' | 'skipped' | 'all';

export interface ReadLocalScanRelationshipArtifactsResult {
  runId: string;
  connectionId: string;
  syncId: string;
  report: KloScanReport;
  relationships: KloRelationshipArtifact;
  diagnostics: KloRelationshipDiagnosticsArtifact | null;
  profile: KloRelationshipProfileArtifact | null;
  paths: {
    relationships: string;
    diagnostics: string | null;
    profile: string | null;
  };
}

function findArtifactPath(report: KloScanReport, fileName: string): string | null {
  return report.artifactPaths.enrichmentArtifacts.find((path) => path.endsWith(`/enrichment/${fileName}`)) ?? null;
}

async function readJsonArtifact<T>(project: KloLocalProject, path: string): Promise<T> {
  const raw = await project.fileStore.readFile(path);
  return JSON.parse(raw.content) as T;
}

async function readOptionalJsonArtifact<T>(project: KloLocalProject, path: string | null): Promise<T | null> {
  if (!path) {
    return null;
  }
  try {
    return await readJsonArtifact<T>(project, path);
  } catch {
    return null;
  }
}

export async function readLocalScanRelationshipArtifacts(
  project: KloLocalProject,
  runId: string,
): Promise<ReadLocalScanRelationshipArtifactsResult | null> {
  const report = await getLocalScanReport(project, runId);
  if (!report) {
    return null;
  }

  const relationshipsPath = findArtifactPath(report, 'relationships.json');
  if (!relationshipsPath) {
    throw new Error(`Scan report "${runId}" does not reference relationships.json`);
  }

  const diagnosticsPath = findArtifactPath(report, 'relationship-diagnostics.json');
  const profilePath = findArtifactPath(report, 'relationship-profile.json');

  return {
    runId,
    connectionId: report.connectionId,
    syncId: report.syncId,
    report,
    relationships: await readJsonArtifact<KloRelationshipArtifact>(project, relationshipsPath),
    diagnostics: await readOptionalJsonArtifact<KloRelationshipDiagnosticsArtifact>(project, diagnosticsPath),
    profile: await readOptionalJsonArtifact<KloRelationshipProfileArtifact>(project, profilePath),
    paths: {
      relationships: relationshipsPath,
      diagnostics: diagnosticsPath,
      profile: profilePath,
    },
  };
}

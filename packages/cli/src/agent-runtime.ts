import { readFile } from 'node:fs/promises';
import { createDefaultLocalQueryExecutor, type KloSqlQueryExecutorPort } from '@klo/context/connections';
import { createPythonSemanticLayerComputePort, type KloSemanticLayerComputePort } from '@klo/context/daemon';
import { createLocalProjectMcpContextPorts, type KloMcpContextPorts } from '@klo/context/mcp';
import { type KloLocalProject, loadKloProject } from '@klo/context/project';
import type { KloCliIo } from './cli-runtime.js';

export const KLO_AGENT_MAX_ROWS_CAP = 1000;

export interface KloAgentRuntimeOptions {
  projectDir: string;
  enableSemanticCompute: boolean;
  enableQueryExecution: boolean;
}

export interface KloAgentRuntime {
  project: KloLocalProject;
  ports: KloMcpContextPorts;
  semanticLayerCompute?: KloSemanticLayerComputePort;
  queryExecutor?: KloSqlQueryExecutorPort;
}

export interface KloAgentRuntimeDeps {
  loadProject?: typeof loadKloProject;
  createContextTools?: typeof createLocalProjectMcpContextPorts;
  createSemanticLayerCompute?: () => KloSemanticLayerComputePort;
  createQueryExecutor?: () => KloSqlQueryExecutorPort;
}

export function writeAgentJson(io: KloCliIo, value: unknown): void {
  io.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function writeAgentJsonError(
  io: KloCliIo,
  message: string,
  detail: Record<string, unknown> = {},
): void {
  io.stderr.write(`${JSON.stringify({ ok: false, error: { message, ...detail } }, null, 2)}\n`);
}

export async function readAgentJsonFile(path: string): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(await readFile(path, 'utf-8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

export function parseAgentMaxRows(value: number | undefined): number {
  if (!Number.isInteger(value) || value === undefined || value <= 0) {
    throw new Error('maxRows is required and must be a positive integer.');
  }
  if (value > KLO_AGENT_MAX_ROWS_CAP) {
    throw new Error(`maxRows must be less than or equal to ${KLO_AGENT_MAX_ROWS_CAP}.`);
  }
  return value;
}

export async function createKloAgentRuntime(
  options: KloAgentRuntimeOptions,
  deps: KloAgentRuntimeDeps = {},
): Promise<KloAgentRuntime> {
  const project = await (deps.loadProject ?? loadKloProject)({ projectDir: options.projectDir });
  const semanticLayerCompute = options.enableSemanticCompute
    ? (deps.createSemanticLayerCompute ?? createPythonSemanticLayerComputePort)()
    : undefined;
  const queryExecutor = options.enableQueryExecution
    ? (deps.createQueryExecutor ?? createDefaultLocalQueryExecutor)()
    : undefined;
  const ports = (deps.createContextTools ?? createLocalProjectMcpContextPorts)(project, {
    ...(semanticLayerCompute ? { semanticLayerCompute } : {}),
    ...(queryExecutor ? { queryExecutor } : {}),
  });
  return {
    project,
    ports,
    ...(semanticLayerCompute ? { semanticLayerCompute } : {}),
    ...(queryExecutor ? { queryExecutor } : {}),
  };
}

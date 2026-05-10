import { createLocalKloLlmProviderFromConfig } from '@klo/context';
import { createDefaultLocalQueryExecutor, type KloSqlQueryExecutorPort } from '@klo/context/connections';
import {
  createHttpSemanticLayerComputePort,
  createPythonSemanticLayerComputePort,
  type KloSemanticLayerComputePort,
} from '@klo/context/daemon';
import { createDefaultLocalIngestAdapters, type LocalIngestMcpOptions } from '@klo/context/ingest';
import {
  createDefaultKloMcpServer,
  createLocalProjectMcpContextPorts,
  type KloMcpContextPorts,
} from '@klo/context/mcp';
import { createLocalProjectMemoryCapture, type MemoryCaptureService } from '@klo/context/memory';
import { type KloLocalProject, loadKloProject } from '@klo/context/project';
import type { LocalScanMcpOptions } from '@klo/context/scan';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createKloCliLocalIngestAdapters } from './local-adapters.js';
import { createKloCliScanConnector } from './local-scan-connectors.js';
import { profileMark } from './startup-profile.js';

profileMark('module:serve');

export interface KloServeArgs {
  mcp: 'stdio';
  projectDir: string;
  userId: string;
  semanticCompute: boolean;
  semanticComputeUrl?: string;
  databaseIntrospectionUrl?: string;
  executeQueries: boolean;
  memoryCapture: boolean;
  memoryModel?: string;
}

interface KloServeIo {
  stderr: { write(chunk: string): void };
}

interface LocalProjectContextToolOptions {
  semanticLayerCompute?: KloSemanticLayerComputePort;
  queryExecutor?: KloSqlQueryExecutorPort;
  localIngest?: LocalIngestMcpOptions;
  localScan?: LocalScanMcpOptions;
}

interface KloServeDeps {
  loadProject?: typeof loadKloProject;
  createContextTools?: (project: KloLocalProject, options?: LocalProjectContextToolOptions) => KloMcpContextPorts;
  createSemanticLayerCompute?: () => KloSemanticLayerComputePort;
  createHttpSemanticLayerCompute?: (baseUrl: string) => KloSemanticLayerComputePort;
  createIngestAdapters?: typeof createDefaultLocalIngestAdapters;
  createQueryExecutor?: () => KloSqlQueryExecutorPort;
  createMemoryCapture?: typeof createLocalProjectMemoryCapture;
  createServer?: typeof createDefaultKloMcpServer;
  createTransport?: () => StdioServerTransport;
  stderr?: KloServeIo['stderr'];
}

export async function runKloServeStdio(args: KloServeArgs, deps: KloServeDeps = {}): Promise<number> {
  const loadProjectFn = deps.loadProject ?? loadKloProject;
  const createContextToolsFn = deps.createContextTools ?? createLocalProjectMcpContextPorts;
  const createServerFn = deps.createServer ?? createDefaultKloMcpServer;
  const createTransportFn = deps.createTransport ?? (() => new StdioServerTransport());
  const stderr = deps.stderr ?? process.stderr;

  const project = await loadProjectFn({ projectDir: args.projectDir });
  const semanticLayerCompute = args.semanticCompute
    ? args.semanticComputeUrl
      ? (deps.createHttpSemanticLayerCompute ?? ((baseUrl) => createHttpSemanticLayerComputePort({ baseUrl })))(
          args.semanticComputeUrl,
        )
      : (deps.createSemanticLayerCompute ?? createPythonSemanticLayerComputePort)()
    : undefined;
  const queryExecutor = args.executeQueries
    ? (deps.createQueryExecutor ?? createDefaultLocalQueryExecutor)()
    : undefined;
  const createIngestAdapters = deps.createIngestAdapters ?? createKloCliLocalIngestAdapters;
  const localAdapters = createIngestAdapters(project, {
    databaseIntrospectionUrl: args.databaseIntrospectionUrl,
  });
  const llmProvider = args.memoryCapture
    ? (createLocalKloLlmProviderFromConfig(project.config.llm) ?? undefined)
    : undefined;
  const memoryCapture: MemoryCaptureService | undefined = args.memoryCapture
    ? (deps.createMemoryCapture ?? createLocalProjectMemoryCapture)(project, {
        llmProvider,
        semanticLayerCompute,
      })
    : undefined;
  const localIngest: LocalIngestMcpOptions = {
    adapters: localAdapters,
    ...(semanticLayerCompute ? { semanticLayerCompute } : {}),
    ...(queryExecutor ? { queryExecutor } : {}),
  };
  const localScan: LocalScanMcpOptions = {
    adapters: localAdapters,
    databaseIntrospectionUrl: args.databaseIntrospectionUrl,
    createConnector: (connectionId) => createKloCliScanConnector(project, connectionId),
  };
  const contextToolOptions: LocalProjectContextToolOptions = {
    localIngest,
    localScan,
    ...(semanticLayerCompute ? { semanticLayerCompute } : {}),
    ...(queryExecutor ? { queryExecutor } : {}),
  };
  const contextTools = createContextToolsFn(project, contextToolOptions);
  const server = createServerFn({
    name: 'klo',
    version: '0.0.0-private',
    userContext: { userId: args.userId },
    contextTools,
    memoryCapture,
  });
  const transport = createTransportFn();
  await server.connect(transport);
  stderr.write(`klo MCP server running on stdio for ${project.projectDir}\n`);
  return 0;
}

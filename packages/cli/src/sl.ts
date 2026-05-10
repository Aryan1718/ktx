import { createDefaultLocalQueryExecutor, type KloSqlQueryExecutorPort } from '@klo/context/connections';
import { createPythonSemanticLayerComputePort, type KloSemanticLayerComputePort } from '@klo/context/daemon';
import { loadKloProject, type KloLocalProject } from '@klo/context/project';
import {
  compileLocalSlQuery,
  listLocalSlSources,
  readLocalSlSource,
  validateLocalSlSource,
  writeLocalSlSource,
  type SemanticLayerQueryInput,
} from '@klo/context/sl';
import { profileMark } from './startup-profile.js';

profileMark('module:sl');

type SlQueryFormat = 'json' | 'sql';

export type KloSlArgs =
  | { command: 'list'; projectDir: string; connectionId?: string; output?: string; json?: boolean }
  | { command: 'read'; projectDir: string; connectionId: string; sourceName: string }
  | { command: 'validate'; projectDir: string; connectionId: string; sourceName: string }
  | { command: 'write'; projectDir: string; connectionId: string; sourceName: string; yaml: string }
  | {
      command: 'query';
      projectDir: string;
      connectionId?: string;
      query: SemanticLayerQueryInput;
      format: SlQueryFormat;
      execute: boolean;
      maxRows?: number;
    };

interface KloSlIo {
  stdout: { write(chunk: string): void };
  stderr: { write(chunk: string): void };
}

interface KloSlDeps {
  loadProject?: typeof loadKloProject;
  createSemanticLayerCompute?: () => KloSemanticLayerComputePort;
  createQueryExecutor?: () => KloSqlQueryExecutorPort;
}

export async function runKloSl(args: KloSlArgs, io: KloSlIo = process, deps: KloSlDeps = {}): Promise<number> {
  try {
    const project = await (deps.loadProject ?? loadKloProject)({ projectDir: args.projectDir });
    if (args.command === 'list') {
      const sources = await listLocalSlSources(project, { connectionId: args.connectionId });
      const { resolveOutputMode } = await import('./io/mode.js');
      const { printList } = await import('./io/print-list.js');
      const mode = resolveOutputMode({ explicit: args.output, json: args.json, io });
      printList({
        rows: sources,
        columns: [
          { key: 'connectionId', label: 'CONNECTION', plain: '' },
          { key: 'name', label: 'NAME', plain: '' },
          { key: 'columnCount', label: 'COLS', plain: 'columns=', dim: true },
          { key: 'measureCount', label: 'MEASURES', plain: 'measures=', dim: true },
          { key: 'joinCount', label: 'JOINS', plain: 'joins=', dim: true },
          { key: 'description', label: 'DESCRIPTION', plain: false, optional: true, dim: true },
        ],
        groupBy: 'connectionId',
        emptyMessage: `No semantic-layer sources found in ${project.projectDir}`,
        command: 'sl list',
        mode,
        io,
      });
      return 0;
    }
    if (args.command === 'read') {
      const source = await readLocalSlSource(project, {
        connectionId: args.connectionId,
        sourceName: args.sourceName,
      });
      if (!source) {
        throw new Error(`Semantic-layer source "${args.connectionId}/${args.sourceName}" was not found`);
      }
      io.stdout.write(source.yaml);
      return 0;
    }
    if (args.command === 'validate') {
      const source = await readLocalSlSource(project, {
        connectionId: args.connectionId,
        sourceName: args.sourceName,
      });
      if (!source) {
        throw new Error(`Semantic-layer source "${args.connectionId}/${args.sourceName}" was not found`);
      }
      const result = await validateLocalSlSource(source.yaml);
      if (!result.valid) {
        for (const error of result.errors) {
          io.stderr.write(`${error}\n`);
        }
        return 1;
      }
      io.stdout.write(`Valid semantic-layer source: ${args.connectionId}/${args.sourceName}\n`);
      return 0;
    }
    if (args.command === 'query') {
      const compute = (deps.createSemanticLayerCompute ?? createPythonSemanticLayerComputePort)();
      const queryExecutor = args.execute ? (deps.createQueryExecutor ?? createDefaultLocalQueryExecutor)() : undefined;
      const result = await compileLocalSlQuery(project as KloLocalProject, {
        connectionId: args.connectionId,
        query: args.query,
        compute,
        execute: args.execute,
        maxRows: args.maxRows,
        queryExecutor,
      });
      if (args.format === 'sql') {
        io.stdout.write(`${result.sql}\n`);
        return 0;
      }
      io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    }

    const write = await writeLocalSlSource(project, {
      connectionId: args.connectionId,
      sourceName: args.sourceName,
      yaml: args.yaml,
    });
    io.stdout.write(`Wrote ${write.path}\n`);
    return 0;
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

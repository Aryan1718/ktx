import { tool } from 'ai';
import { z } from 'zod';
import type { StageIndex } from '../stages/stage-index.types.js';

export interface StageListDeps {
  stageIndex: StageIndex;
}

export function createStageListTool(deps: StageListDeps) {
  return tool({
    description:
      'List every write made by Stage 3 WorkUnits in this job. Each entry has the unitKey, raw files, and the action set (SL sources touched, wiki pages written).',
    inputSchema: z.object({}),
    execute: () => {
      if (deps.stageIndex.workUnits.length === 0) {
        return Promise.resolve('(empty) — no WorkUnits wrote anything in this job');
      }
      const out = deps.stageIndex.workUnits
        .map((wu) => {
          const actions =
            wu.actions.length === 0
              ? '  (no actions)'
              : wu.actions.map((a) => `  - ${a.target}:${a.type} ${a.key}`).join('\n');
          return `- unitKey: ${wu.unitKey} (status=${wu.status})\n  rawFiles: ${wu.rawFiles.join(', ') || '(none)'}\n  actions:\n${actions}`;
        })
        .join('\n');
      return Promise.resolve(out);
    },
  });
}

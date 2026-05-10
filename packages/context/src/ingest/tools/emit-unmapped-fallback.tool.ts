import { tool } from 'ai';
import { z } from 'zod';
import type { StageIndex, UnmappedFallbackRecord } from '../stages/stage-index.types.js';

interface EmitUnmappedFallbackDeps {
  stageIndex: StageIndex;
  allowedPaths: ReadonlySet<string>;
}

const unmappedFallbackReasonSchema = z.enum([
  'no_connection_mapping',
  'looker_template_unresolved',
  'derived_table_not_supported',
  'no_physical_table',
  'multiple_table_references',
  'unsupported_dialect',
  'parse_error',
  'missing_target_table',
]);

function sameUnmappedFallback(left: UnmappedFallbackRecord, right: UnmappedFallbackRecord): boolean {
  return left.rawPath === right.rawPath && left.reason === right.reason && left.fallback === right.fallback;
}

export function createEmitUnmappedFallbackTool(deps: EmitUnmappedFallbackDeps) {
  return tool({
    description:
      'Record one unmapped fallback decision for the final IngestReport. The rawPath must be available to the current ingest stage. The reason MUST be one of the structured codes; put any human-readable context in detail.',
    inputSchema: z.object({
      rawPath: z.string().min(1),
      reason: unmappedFallbackReasonSchema,
      detail: z.string().optional(),
      fallback: z.enum(['sql_standalone', 'wiki_only', 'flagged']),
    }),
    execute: async (input): Promise<string> => {
      if (!deps.allowedPaths.has(input.rawPath)) {
        return `Error: rawPath "${input.rawPath}" is not available to this ingest stage`;
      }

      const record: UnmappedFallbackRecord = {
        rawPath: input.rawPath,
        reason: input.reason,
        ...(input.detail !== undefined ? { detail: input.detail } : {}),
        fallback: input.fallback,
      };
      if (!deps.stageIndex.unmappedFallbacks.some((candidate) => sameUnmappedFallback(candidate, record))) {
        deps.stageIndex.unmappedFallbacks.push(record);
      }
      return `recorded unmapped fallback for ${record.rawPath} (${record.fallback})`;
    },
  });
}

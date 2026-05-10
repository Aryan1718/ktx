import { KloMessageBuilder, type KloLlmProvider, type KloModelRole } from '@klo/llm';
import { generateText, stepCountIs, type TelemetrySettings, type Tool } from 'ai';
import { noopLogger, type KloLogger } from '../core/index.js';
import { summarizeKloLlmDebugRequest, type KloLlmDebugRequestRecorder } from '../llm/index.js';

export type RunLoopStopReason = 'budget' | 'natural' | 'error';

export interface RunLoopStepInfo {
  stepIndex: number;
  stepBudget: number;
}

export interface RunLoopParams {
  modelRole: KloModelRole;
  systemPrompt: string;
  userPrompt: string;
  toolSet: Record<string, Tool>;
  stepBudget: number;
  telemetryTags: Record<string, string>;
  onStepFinish?: (info: RunLoopStepInfo) => void | Promise<void>;
}

export interface RunLoopResult {
  stopReason: RunLoopStopReason;
  error?: Error;
}

export interface AgentTelemetryPort {
  createTelemetry(tags: Record<string, string>): TelemetrySettings;
}

export interface AgentRunnerServiceDeps {
  llmProvider: KloLlmProvider;
  telemetry?: AgentTelemetryPort;
  debugRequestRecorder?: KloLlmDebugRequestRecorder;
  logger?: KloLogger;
}

export class AgentRunnerService {
  private readonly logger: KloLogger;

  constructor(private readonly deps: AgentRunnerServiceDeps) {
    this.logger = deps.logger ?? noopLogger;
  }

  async runLoop(params: RunLoopParams): Promise<RunLoopResult> {
    let stepIndex = 0;
    try {
      const model = this.deps.llmProvider.getModel(params.modelRole);
      const builder = new KloMessageBuilder(this.deps.llmProvider);
      const built = builder.wrapSimple({
        system: params.systemPrompt,
        messages: [{ role: 'user', content: params.userPrompt }],
        tools: params.toolSet,
        model,
      });

      await this.deps.debugRequestRecorder?.record(
        summarizeKloLlmDebugRequest({
          operationName: params.telemetryTags.operationName ?? 'klo-agent-runner',
          source: params.telemetryTags.source,
          jobId: params.telemetryTags.jobId,
          unitKey: params.telemetryTags.unitKey,
          modelRole: params.modelRole,
          modelId: (model as { modelId?: string }).modelId ?? params.modelRole,
          messages: built.messages,
          tools: built.tools as Record<string, { providerOptions?: unknown }>,
        }),
      );

      await generateText({
        model,
        temperature: 0,
        stopWhen: stepCountIs(params.stepBudget),
        experimental_telemetry: this.deps.telemetry?.createTelemetry(params.telemetryTags),
        messages: built.messages,
        tools: built.tools as Record<string, Tool>,
        onStepFinish: async () => {
          stepIndex += 1;
          if (!params.onStepFinish) {
            return;
          }
          try {
            await params.onStepFinish({ stepIndex, stepBudget: params.stepBudget });
          } catch (err) {
            this.logger.warn(
              `[agent-runner] onStepFinish callback threw; ignoring: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        },
      });
      return { stopReason: 'natural' };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(`[agent-runner] loop failed: ${err.message}`);
      return { stopReason: 'error', error: err };
    }
  }
}

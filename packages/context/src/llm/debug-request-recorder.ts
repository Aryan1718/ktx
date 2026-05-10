import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ModelMessage } from 'ai';
import type { KloModelRole } from '@klo/llm';

type ProviderOptionsCarrier = { providerOptions?: unknown; [key: string]: unknown };
type ToolMap = Record<string, ProviderOptionsCarrier>;

export interface KloLlmDebugProviderOptionsEntry {
  target: 'message' | 'message-part' | 'tool';
  index?: number;
  role?: string;
  partIndex?: number;
  name?: string;
  providerOptions: unknown;
}

export interface KloLlmDebugRequest {
  timestamp: string;
  operationName: string;
  source?: string;
  jobId?: string;
  unitKey?: string;
  modelRole: KloModelRole;
  modelId: string;
  messageCount: number;
  toolNames: string[];
  providerOptions: KloLlmDebugProviderOptionsEntry[];
}

export interface KloLlmDebugRequestRecorder {
  record(request: KloLlmDebugRequest): Promise<void> | void;
}

export interface SummarizeKloLlmDebugRequestInput {
  operationName: string;
  source?: string;
  jobId?: string;
  unitKey?: string;
  modelRole: KloModelRole;
  modelId: string;
  messages: ModelMessage[];
  tools: ToolMap;
  timestamp?: string;
}

function messageRole(message: ModelMessage): string {
  return typeof message.role === 'string' ? message.role : 'unknown';
}

function isProviderOptionsCarrier(value: unknown): value is ProviderOptionsCarrier {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function contentPartProviderOptions(message: ModelMessage, index: number): KloLlmDebugProviderOptionsEntry[] {
  if (!Array.isArray(message.content)) {
    return [];
  }

  return message.content.flatMap((part, partIndex) => {
    if (!isProviderOptionsCarrier(part) || !part.providerOptions) {
      return [];
    }

    return [
      {
        target: 'message-part' as const,
        index,
        role: messageRole(message),
        partIndex,
        providerOptions: part.providerOptions,
      },
    ];
  });
}

function messageProviderOptions(messages: ModelMessage[]): KloLlmDebugProviderOptionsEntry[] {
  return messages.flatMap((message, index) => {
    const entries: KloLlmDebugProviderOptionsEntry[] = [];
    const providerOptions = (message as ProviderOptionsCarrier).providerOptions;
    if (providerOptions) {
      entries.push({
        target: 'message',
        index,
        role: messageRole(message),
        providerOptions,
      });
    }
    entries.push(...contentPartProviderOptions(message, index));
    return entries;
  });
}

function toolProviderOptions(tools: ToolMap): KloLlmDebugProviderOptionsEntry[] {
  return Object.entries(tools).flatMap(([name, tool]) => {
    return tool.providerOptions
      ? [
          {
            target: 'tool' as const,
            name,
            providerOptions: tool.providerOptions,
          },
        ]
      : [];
  });
}

export function summarizeKloLlmDebugRequest(input: SummarizeKloLlmDebugRequestInput): KloLlmDebugRequest {
  const toolNames = Object.keys(input.tools).sort();
  return {
    timestamp: input.timestamp ?? new Date().toISOString(),
    operationName: input.operationName,
    ...(input.source ? { source: input.source } : {}),
    ...(input.jobId ? { jobId: input.jobId } : {}),
    ...(input.unitKey ? { unitKey: input.unitKey } : {}),
    modelRole: input.modelRole,
    modelId: input.modelId,
    messageCount: input.messages.length,
    toolNames,
    providerOptions: [...messageProviderOptions(input.messages), ...toolProviderOptions(input.tools)],
  };
}

export function createJsonlKloLlmDebugRequestRecorder(filePath: string): KloLlmDebugRequestRecorder {
  return {
    async record(request) {
      await mkdir(dirname(filePath), { recursive: true });
      await appendFile(filePath, `${JSON.stringify(request)}\n`, 'utf8');
    },
  };
}

import { KloMessageBuilder, type KloLlmProvider, type KloModelRole } from '@klo/llm';
import { generateText, Output, type FlexibleSchema, type ToolSet } from 'ai';

type GenerateTextInput = Parameters<typeof generateText>[0];
type GenerateTextFn = (input: GenerateTextInput) => Promise<{ text?: string; output?: unknown }>;

interface GenerateKloTextInput {
  llmProvider: KloLlmProvider;
  role: KloModelRole;
  prompt: string;
  system?: string;
  tools?: ToolSet;
  temperature?: number;
  generateText?: GenerateTextFn;
}

export async function generateKloText(input: GenerateKloTextInput): Promise<string> {
  const model = input.llmProvider.getModel(input.role);
  if ((model as { provider?: string }).provider === 'deterministic') {
    return `Deterministic description for ${input.prompt.slice(0, 64).trim() || 'data source'}`;
  }
  const built = new KloMessageBuilder(input.llmProvider).wrapSimple({
    system: input.system,
    messages: [{ role: 'user', content: input.prompt }],
    tools: input.tools ?? {},
    model,
  });
  const result = await (input.generateText ?? generateText)({
    model,
    temperature: input.temperature ?? 0,
    messages: built.messages,
    tools: built.tools as ToolSet,
  });
  if (typeof result.text !== 'string') {
    throw new Error('KLO LLM text generation returned no text');
  }
  return result.text;
}

export async function generateKloObject<TOutput, TSchema>(
  input: GenerateKloTextInput & { schema: TSchema },
): Promise<TOutput> {
  const model = input.llmProvider.getModel(input.role);
  const built = new KloMessageBuilder(input.llmProvider).wrapSimple({
    system: input.system,
    messages: [{ role: 'user', content: input.prompt }],
    tools: input.tools ?? {},
    model,
  });
  const result = await (input.generateText ?? generateText)({
    model,
    temperature: input.temperature ?? 0,
    messages: built.messages,
    tools: built.tools as ToolSet,
    output: Output.object({
      schema: input.schema as FlexibleSchema<TOutput>,
    }),
  });
  if (result.output == null) {
    throw new Error('KLO LLM object generation returned no output');
  }
  return result.output as TOutput;
}

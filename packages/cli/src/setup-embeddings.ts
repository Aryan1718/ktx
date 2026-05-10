import { writeFile } from 'node:fs/promises';
import { cancel, isCancel, password, select } from '@clack/prompts';
import { resolveKloConfigReference } from '@klo/context/core';
import {
  type KloProjectConfig,
  type KloProjectEmbeddingConfig,
  loadKloProject,
  markKloSetupStepComplete,
  serializeKloProjectConfig,
} from '@klo/context/project';
import { type KloEmbeddingConfig, type KloEmbeddingHealthCheckResult, runKloEmbeddingHealthCheck } from '@klo/llm';
import type { KloCliIo } from './cli-runtime.js';
import { withMenuOptionsSpacing, withTextInputNavigation } from './prompt-navigation.js';
import { withSetupInterruptConfirmation } from './setup-interrupt.js';
import { envCredentialReference, writeProjectLocalSecretReference } from './setup-secrets.js';

export type KloSetupEmbeddingBackend = 'openai' | 'sentence-transformers';

export interface KloSetupEmbeddingsArgs {
  projectDir: string;
  inputMode: 'auto' | 'disabled';
  embeddingBackend?: KloSetupEmbeddingBackend;
  embeddingApiKeyEnv?: string;
  embeddingApiKeyFile?: string;
  forcePrompt?: boolean;
  showPromptInstructions?: boolean;
  skipEmbeddings: boolean;
}

export type KloSetupEmbeddingsResult =
  | { status: 'ready'; projectDir: string }
  | { status: 'skipped'; projectDir: string }
  | { status: 'back'; projectDir: string }
  | { status: 'missing-input'; projectDir: string }
  | { status: 'failed'; projectDir: string };

export interface KloSetupEmbeddingsPromptAdapter {
  select(options: { message: string; options: Array<{ value: string; label: string }> }): Promise<string>;
  password(options: { message: string }): Promise<string | undefined>;
  cancel(message: string): void;
}

export interface KloSetupEmbeddingsDeps {
  env?: NodeJS.ProcessEnv;
  prompts?: KloSetupEmbeddingsPromptAdapter;
  healthCheck?: (config: KloEmbeddingConfig) => Promise<KloEmbeddingHealthCheckResult>;
}

type BackendChoice = KloSetupEmbeddingBackend | 'back';

const DEFAULTS: Record<
  KloSetupEmbeddingBackend,
  { model: string; dimensions: number; envName?: string; baseUrl?: string; pathPrefix?: string }
> = {
  openai: { model: 'text-embedding-3-small', dimensions: 1536, envName: 'OPENAI_API_KEY' },
  'sentence-transformers': {
    model: 'all-MiniLM-L6-v2',
    dimensions: 384,
    baseUrl: 'http://127.0.0.1:8765',
    pathPrefix: '',
  },
};

const LOCAL_EMBEDDING_BACKEND: KloSetupEmbeddingBackend = 'sentence-transformers';
const LOCAL_EMBEDDING_DAEMON_COMMAND = 'klo-daemon serve-http --host 127.0.0.1 --port 8765';
const LOCAL_EMBEDDING_DAEMON_DEV_COMMAND =
  'cd klo && source .venv/bin/activate && uv run klo-daemon serve-http --host 127.0.0.1 --port 8765';
const EMBEDDING_OPTION_PROMPT_CONTEXT =
  'KLO uses embeddings for semantic search over semantic-layer sources, wiki context, schema metadata, ' +
  'and relationship evidence.';
const LOCAL_EMBEDDING_HEALTH_TIMEOUT_MS = 120_000;
const HEALTH_CHECK_SPINNER_FRAMES = ['-', '\\', '|', '/'] as const;
const HEALTH_CHECK_SPINNER_INTERVAL_MS = 120;
const CLEAR_CURRENT_LINE = '\x1b[2K\r';

interface HealthCheckProgress {
  succeed(message: string): void;
  fail(message: string): void;
}

function createPromptAdapter(): KloSetupEmbeddingsPromptAdapter {
  return {
    async select(options) {
      const value = await withSetupInterruptConfirmation(() => select(withMenuOptionsSpacing(options)));
      if (isCancel(value)) {
        cancel('Setup cancelled.');
        return 'back';
      }
      return value;
    },
    async password(options) {
      const value = await withSetupInterruptConfirmation(() =>
        password({ ...options, message: withTextInputNavigation(options.message) }),
      );
      return isCancel(value) ? undefined : value;
    },
    cancel(message) {
      cancel(message);
    },
  };
}

function hasCompletedEmbeddings(config: KloProjectConfig): boolean {
  return (
    config.setup?.completed_steps.includes('embeddings') === true &&
    config.ingest.embeddings.backend !== 'none' &&
    config.ingest.embeddings.backend !== 'deterministic' &&
    typeof config.ingest.embeddings.model === 'string' &&
    config.ingest.embeddings.model.length > 0 &&
    config.ingest.embeddings.dimensions > 0
  );
}

function buildProjectEmbeddingConfig(input: {
  backend: KloSetupEmbeddingBackend;
  model: string;
  dimensions: number;
  credentialRef?: string;
}): KloProjectEmbeddingConfig {
  if (input.backend === 'openai') {
    return {
      backend: 'openai',
      model: input.model,
      dimensions: input.dimensions,
      openai: {
        ...(input.credentialRef ? { api_key: input.credentialRef } : {}),
      },
    };
  }
  const defaults = DEFAULTS[input.backend];
  return {
    backend: input.backend,
    model: input.model,
    dimensions: input.dimensions,
    sentenceTransformers: {
      base_url: defaults.baseUrl ?? '',
      pathPrefix: defaults.pathPrefix ?? '',
    },
  };
}

function buildHealthConfig(input: {
  backend: KloSetupEmbeddingBackend;
  model: string;
  dimensions: number;
  credentialValue?: string;
}): KloEmbeddingConfig {
  if (input.backend === 'openai') {
    return {
      backend: 'openai',
      model: input.model,
      dimensions: input.dimensions,
      openai: {
        ...(input.credentialValue ? { apiKey: input.credentialValue } : {}),
      },
    };
  }
  const defaults = DEFAULTS[input.backend];
  return {
    backend: input.backend,
    model: input.model,
    dimensions: input.dimensions,
    sentenceTransformers: {
      baseURL: defaults.baseUrl ?? '',
      pathPrefix: defaults.pathPrefix ?? '',
    },
  };
}

function embeddingBackendDisplayName(backend: KloSetupEmbeddingBackend): string {
  if (backend === 'openai') {
    return 'OpenAI';
  }
  return 'sentence-transformers';
}

async function persistEmbeddingConfig(projectDir: string, embeddings: KloProjectEmbeddingConfig): Promise<void> {
  const project = await loadKloProject({ projectDir });
  const config = markKloSetupStepComplete(
    {
      ...project.config,
      ingest: {
        ...project.config.ingest,
        embeddings,
      },
      scan: {
        ...project.config.scan,
        enrichment: {
          ...project.config.scan.enrichment,
          embeddings,
        },
      },
    },
    'embeddings',
  );
  await writeFile(project.configPath, serializeKloProjectConfig(config), 'utf-8');
}

async function chooseCredentialRef(
  backend: Extract<KloSetupEmbeddingBackend, 'openai'>,
  args: KloSetupEmbeddingsArgs,
  io: KloCliIo,
  deps: KloSetupEmbeddingsDeps,
): Promise<{ status: 'ready'; ref: string; value: string } | { status: 'back' | 'missing-input' }> {
  const env = deps.env ?? process.env;
  if (args.embeddingApiKeyEnv) {
    const ref = envCredentialReference(args.embeddingApiKeyEnv);
    const value = resolveKloConfigReference(ref, env);
    if (!value) {
      io.stderr.write(`Missing embedding API key: ${args.embeddingApiKeyEnv} is not set.\n`);
      return { status: 'missing-input' };
    }
    return { status: 'ready', ref, value };
  }
  if (args.embeddingApiKeyFile) {
    const ref = `file:${args.embeddingApiKeyFile}`;
    let value: string | undefined;
    try {
      value = resolveKloConfigReference(ref, env);
    } catch {
      value = undefined;
    }
    if (!value) {
      io.stderr.write(`Missing embedding API key file: ${args.embeddingApiKeyFile}\n`);
      return { status: 'missing-input' };
    }
    return { status: 'ready', ref, value };
  }
  if (args.inputMode === 'disabled') {
    io.stderr.write('Missing embedding API key: pass --embedding-api-key-env or --embedding-api-key-file.\n');
    return { status: 'missing-input' };
  }

  const defaultEnv = DEFAULTS[backend].envName ?? 'EMBEDDING_API_KEY';
  const prompts = deps.prompts ?? createPromptAdapter();
  const choice = await prompts.select({
    message: `How should KLO find your ${embeddingBackendDisplayName(backend)} embedding API key?`,
    options: [
      { value: 'env', label: `Use ${defaultEnv} from the environment` },
      { value: 'paste', label: 'Paste a key and save it as a local secret file' },
      { value: 'back', label: 'Back' },
    ],
  });
  if (choice === 'back') {
    return { status: 'back' };
  }
  if (choice === 'paste') {
    io.stdout.write(
      `${[
        `KLO will save the key in .klo/secrets/${backend}-api-key with local file permissions,`,
        'then write a file: reference in klo.yaml.',
      ].join(' ')}\n`,
    );
    const value = await prompts.password({ message: withTextInputNavigation(`${backend} embedding API key`) });
    if (value === undefined) {
      return { status: 'back' };
    }
    if (!value.trim()) {
      return { status: 'missing-input' };
    }
    const ref = await writeProjectLocalSecretReference({
      projectDir: args.projectDir,
      fileName: `${backend}-api-key`,
      value,
    });
    return { status: 'ready', ref, value: value.trim() };
  }

  const ref = envCredentialReference(defaultEnv);
  const value = resolveKloConfigReference(ref, env);
  if (!value) {
    io.stderr.write(`Missing embedding API key: ${defaultEnv} is not set.\n`);
    return { status: 'missing-input' };
  }
  return { status: 'ready', ref, value };
}

async function chooseEmbeddingBackend(
  args: KloSetupEmbeddingsArgs,
  deps: KloSetupEmbeddingsDeps,
): Promise<BackendChoice> {
  if (args.embeddingBackend) {
    return args.embeddingBackend;
  }
  if (args.inputMode === 'disabled') {
    return LOCAL_EMBEDDING_BACKEND;
  }
  const choice = await (deps.prompts ?? createPromptAdapter()).select({
    message: `Which embedding option should KLO use?\n\n${EMBEDDING_OPTION_PROMPT_CONTEXT}`,
    options: [
      { value: 'sentence-transformers', label: 'Local sentence-transformers embeddings' },
      { value: 'openai', label: 'OpenAI embeddings (recommended)' },
      { value: 'back', label: 'Back' },
    ],
  });
  if (choice === 'openai' || choice === 'sentence-transformers' || choice === 'back') {
    return choice;
  }
  return 'back';
}

function localEmbeddingSetupMessage(message: string): string {
  return [
    `Local embedding health check failed: ${message}`,
    'Local embeddings use the KLO Python daemon. KLO can call klo-daemon automatically when it is on PATH.',
    `For repeated inference, start the HTTP daemon in another terminal with: ${LOCAL_EMBEDDING_DAEMON_COMMAND}`,
    `From the KLO repo, use: ${LOCAL_EMBEDDING_DAEMON_DEV_COMMAND}`,
    'The first run may download the all-MiniLM-L6-v2 model, so it can take a minute.',
  ].join('\n');
}

async function promptAfterLocalEmbeddingFailure(
  deps: KloSetupEmbeddingsDeps,
): Promise<'retry' | Extract<KloSetupEmbeddingBackend, 'openai'> | 'back'> {
  const choice = await (deps.prompts ?? createPromptAdapter()).select({
    message: 'Local embeddings are not reachable. Start the local KLO daemon, then retry.',
    options: [
      { value: 'retry', label: 'Retry' },
      { value: 'openai', label: 'Use OpenAI embeddings' },
      { value: 'back', label: 'Back' },
    ],
  });
  if (choice === 'openai' || choice === 'back') {
    return choice;
  }
  return 'retry';
}

function healthCheckStartText(backend: KloSetupEmbeddingBackend, model: string, dimensions: number): string {
  if (backend === LOCAL_EMBEDDING_BACKEND) {
    return [
      `Testing local sentence-transformers embeddings (${model}, ${dimensions} dimensions).`,
      'First run may take up to 60 seconds.',
    ].join(' ');
  }
  return `Checking ${backend} embeddings (${model}, ${dimensions} dimensions).`;
}

function startHealthCheckProgress(io: KloCliIo, message: string): HealthCheckProgress {
  if (io.stdout.isTTY !== true) {
    io.stdout.write(`${message}\n`);
    const noop = () => undefined;
    return {
      succeed: noop,
      fail: noop,
    };
  }

  let frameIndex = 0;
  let stopped = false;
  const writeFrame = () => {
    io.stdout.write(`${CLEAR_CURRENT_LINE}${HEALTH_CHECK_SPINNER_FRAMES[frameIndex]} ${message}`);
  };
  writeFrame();
  const interval = setInterval(() => {
    frameIndex = (frameIndex + 1) % HEALTH_CHECK_SPINNER_FRAMES.length;
    writeFrame();
  }, HEALTH_CHECK_SPINNER_INTERVAL_MS);

  const stop = (finalMessage: string) => {
    if (stopped) {
      return;
    }
    stopped = true;
    clearInterval(interval);
    io.stdout.write(`${CLEAR_CURRENT_LINE}${finalMessage}\n`);
  };

  return {
    succeed(message) {
      stop(message);
    },
    fail(message) {
      stop(message);
    },
  };
}

export async function runKloSetupEmbeddingsStep(
  args: KloSetupEmbeddingsArgs,
  io: KloCliIo,
  deps: KloSetupEmbeddingsDeps = {},
): Promise<KloSetupEmbeddingsResult> {
  if (args.skipEmbeddings) {
    io.stdout.write('Embeddings setup skipped.\n');
    return { status: 'skipped', projectDir: args.projectDir };
  }

  const project = await loadKloProject({ projectDir: args.projectDir });
  if (
    args.forcePrompt !== true &&
    hasCompletedEmbeddings(project.config) &&
    !args.embeddingBackend &&
    !args.embeddingApiKeyEnv &&
    !args.embeddingApiKeyFile
  ) {
    io.stdout.write(`Embeddings ready: yes (${project.config.ingest.embeddings.model})\n`);
    return { status: 'ready', projectDir: args.projectDir };
  }

  const healthCheck =
    deps.healthCheck ??
    ((config: KloEmbeddingConfig) =>
      runKloEmbeddingHealthCheck(config, { timeoutMs: LOCAL_EMBEDDING_HEALTH_TIMEOUT_MS }));
  let selectedBackend: KloSetupEmbeddingBackend | undefined;

  while (true) {
    if (!selectedBackend) {
      const backend = await chooseEmbeddingBackend(args, deps);
      if (backend === 'back') {
        return { status: 'back', projectDir: args.projectDir };
      }
      selectedBackend = backend;
    }

    const defaults = DEFAULTS[selectedBackend];
    const model = defaults.model;
    const dimensions = defaults.dimensions;
    let credentialRef: string | undefined;
    let credentialValue: string | undefined;

    if (selectedBackend === 'openai') {
      const credential = await chooseCredentialRef(selectedBackend, args, io, deps);
      if (credential.status === 'back' && !args.embeddingBackend && args.inputMode !== 'disabled') {
        selectedBackend = undefined;
        continue;
      }
      if (credential.status !== 'ready') {
        return { status: credential.status, projectDir: args.projectDir };
      }
      credentialRef = credential.ref;
      credentialValue = credential.value;
    }

    const healthConfig = buildHealthConfig({
      backend: selectedBackend,
      model,
      dimensions,
      credentialValue,
    });
    const progress = startHealthCheckProgress(io, healthCheckStartText(selectedBackend, model, dimensions));
    let health: KloEmbeddingHealthCheckResult;
    try {
      health = await healthCheck(healthConfig);
    } catch (error) {
      progress.fail('Embedding test failed');
      throw error;
    }
    if (health.ok) {
      progress.succeed(`Embedding test passed (${model}, ${dimensions} dimensions)`);
      await persistEmbeddingConfig(
        args.projectDir,
        buildProjectEmbeddingConfig({
          backend: selectedBackend,
          model,
          dimensions,
          credentialRef,
        }),
      );
      io.stdout.write(`Embeddings ready: yes (${model}, ${dimensions} dimensions)\n`);
      return { status: 'ready', projectDir: args.projectDir };
    }

    progress.fail('Embedding test failed');
    io.stderr.write(
      selectedBackend === 'sentence-transformers'
        ? `${localEmbeddingSetupMessage(health.message)}\n`
        : `Embedding health check failed: ${health.message}\n`,
    );
    if (args.inputMode === 'disabled') {
      return { status: 'failed', projectDir: args.projectDir };
    }
    if (selectedBackend !== 'sentence-transformers' && (args.embeddingApiKeyEnv || args.embeddingApiKeyFile)) {
      return { status: 'failed', projectDir: args.projectDir };
    }
    const nextAction =
      selectedBackend === 'sentence-transformers' ? await promptAfterLocalEmbeddingFailure(deps) : 'retry';
    if (nextAction === 'back') {
      return { status: 'back', projectDir: args.projectDir };
    }
    if (nextAction === 'openai') {
      selectedBackend = nextAction;
    }
  }
}

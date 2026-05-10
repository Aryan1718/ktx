import { profileMark } from './startup-profile.js';

export {
  getKloCliPackageInfo,
  runInitForCommander,
  runKloCli,
  type KloCliDeps,
  type KloCliIo,
  type KloCliPackageInfo,
} from './cli-runtime.js';
export { runKloAgent, type KloAgentArgs } from './agent.js';
export {
  KLO_AGENT_MAX_ROWS_CAP,
  createKloAgentRuntime,
  parseAgentMaxRows,
  readAgentJsonFile,
  writeAgentJson,
  writeAgentJsonError,
  type KloAgentRuntime,
  type KloAgentRuntimeDeps,
} from './agent-runtime.js';
export { runKloSetup, type KloSetupArgs, type KloSetupStatus } from './setup.js';
export type {
  KloSetupDatabaseDriver,
  KloSetupDatabasesArgs,
  KloSetupDatabasesDeps,
  KloSetupDatabasesResult,
} from './setup-databases.js';
export { runKloSetupDatabasesStep } from './setup-databases.js';
export type {
  KloSetupEmbeddingBackend,
  KloSetupEmbeddingsArgs,
  KloSetupEmbeddingsDeps,
  KloSetupEmbeddingsResult,
} from './setup-embeddings.js';
export { runKloSetupEmbeddingsStep } from './setup-embeddings.js';
export type {
  KloSetupSourcesArgs,
  KloSetupSourcesDeps,
  KloSetupSourcesPromptAdapter,
  KloSetupSourcesResult,
  KloSetupSourceType,
} from './setup-sources.js';
export { runKloSetupSourcesStep } from './setup-sources.js';
export type { KloMemoryFlowTuiIo, MemoryFlowTuiLiveSession } from './memory-flow-tui.js';
export {
  renderMemoryFlowTui,
  sanitizeMemoryFlowTuiError,
  startLiveMemoryFlowTui,
} from './memory-flow-tui.js';
export { rendererUnavailableVizFallback, resolveVizFallback, warnVizFallbackOnce } from './viz-fallback.js';

profileMark('module:index');

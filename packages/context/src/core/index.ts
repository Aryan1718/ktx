export type { KloCoreConfig, KloGitConfig, KloLogger, KloStorageConfig } from './config.js';
export { noopLogger, resolveConfigDir, resolveWorktreesDir } from './config.js';
export { resolveKloConfigReference, resolveKloHomePath } from './config-reference.js';
export type { KloEmbeddingPort } from './embedding.js';
export {
  REDACTED_KLO_CREDENTIAL_VALUE,
  redactKloSensitiveMetadata,
  redactKloSensitiveText,
  redactKloSensitiveValue,
} from './redaction.js';
export type {
  KloFileHistoryEntry,
  KloFileListResult,
  KloFileReadResult,
  KloFileStorePort,
  KloFileWriteResult,
} from './file-store.js';
export type { GitCommitInfo, SquashMergeResult, WorktreeEntry } from './git.service.js';
export { GitService } from './git.service.js';
export type {
  SentinelPayload,
  SessionOutcome,
  SessionWorktree,
  SessionWorktreeServiceDeps,
  WorktreeConfigPort,
} from './session-worktree.service.js';
export { SessionWorktreeService } from './session-worktree.service.js';

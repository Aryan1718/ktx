export interface KloStorageConfig {
  configDir?: string;
  homeDir?: string;
  worktreesDir?: string;
}

export interface KloGitConfig {
  userName: string;
  userEmail: string;
  bootstrapMessage?: string;
  bootstrapAuthor?: string;
  bootstrapAuthorEmail?: string;
}

export interface KloCoreConfig {
  storage: KloStorageConfig;
  git: KloGitConfig;
}

export interface KloLogger {
  debug(message: string): void;
  log(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
}

export const noopLogger: KloLogger = {
  debug: () => undefined,
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export function resolveConfigDir(config: KloCoreConfig): string {
  const homeDir = config.storage.homeDir ?? '/tmp';
  return config.storage.configDir ?? `${homeDir}/klo/config`;
}

export function resolveWorktreesDir(config: KloCoreConfig): string {
  const homeDir = config.storage.homeDir ?? '/tmp';
  return config.storage.worktreesDir ?? `${homeDir}/.worktrees`;
}

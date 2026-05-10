import { type SimpleGit, simpleGit } from 'simple-git';

const PRE_COMMIT_GIT_ENV = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_PARAMETERS',
  'GIT_DIR',
  'GIT_EXEC_PATH',
  'GIT_INDEX_FILE',
  'GIT_PREFIX',
  'GIT_WORK_TREE',
] as const;

export function createSimpleGit(baseDir?: string): SimpleGit {
  const env = { ...process.env };
  for (const key of PRE_COMMIT_GIT_ENV) {
    delete env[key];
  }
  return simpleGit(baseDir).env(env);
}

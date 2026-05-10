import { promises as fs } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { GitService, type KloCoreConfig, type KloLogger, noopLogger } from '../core/index.js';
import type { KloProjectConfig } from './config.js';
import { buildDefaultKloProjectConfig, parseKloProjectConfig, serializeKloProjectConfig } from './config.js';
import { LocalGitFileStore } from './local-git-file-store.js';

export interface InitKloProjectOptions {
  projectDir: string;
  projectName?: string;
  force?: boolean;
  authorName?: string;
  authorEmail?: string;
  logger?: KloLogger;
}

export interface LoadKloProjectOptions {
  projectDir: string;
  authorName?: string;
  authorEmail?: string;
  logger?: KloLogger;
}

export interface KloLocalProject {
  projectDir: string;
  configPath: string;
  config: KloProjectConfig;
  coreConfig: KloCoreConfig;
  git: GitService;
  fileStore: LocalGitFileStore;
}

export interface InitKloProjectResult extends KloLocalProject {
  commitHash: string | null;
}

const TRACKED_SCAFFOLD_FILES: Array<{ path: string; content: string }> = [
  { path: '.klo/.gitignore', content: 'cache/\ndb.sqlite\nsecrets/\nsetup/\nagents/\n' },
  { path: '.klo/prompts/.gitkeep', content: '' },
  { path: '.klo/skills/.gitkeep', content: '' },
  { path: 'knowledge/global/.gitkeep', content: '' },
  { path: 'semantic-layer/.gitkeep', content: '' },
  { path: 'raw-sources/.gitkeep', content: '' },
];

function createCoreConfig(projectDir: string, authorName: string, authorEmail: string): KloCoreConfig {
  return {
    storage: {
      configDir: projectDir,
      homeDir: dirname(projectDir),
      worktreesDir: join(projectDir, '.klo/worktrees'),
    },
    git: {
      userName: authorName,
      userEmail: authorEmail,
      bootstrapMessage: 'Initialize klo project repository',
      bootstrapAuthor: authorName,
      bootstrapAuthorEmail: authorEmail,
    },
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeProjectFile(projectDir: string, relativePath: string, content: string): Promise<void> {
  const absolutePath = join(projectDir, relativePath);
  await fs.mkdir(dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, 'utf-8');
}

async function createRuntime(
  projectDir: string,
  config: KloProjectConfig,
  authorName: string,
  authorEmail: string,
  logger: KloLogger,
): Promise<KloLocalProject> {
  const coreConfig = createCoreConfig(projectDir, authorName, authorEmail);
  const git = new GitService(coreConfig, logger);
  await git.onModuleInit();

  return {
    projectDir,
    configPath: join(projectDir, 'klo.yaml'),
    config,
    coreConfig,
    git,
    fileStore: new LocalGitFileStore({ rootDir: projectDir, git }),
  };
}

export async function initKloProject(options: InitKloProjectOptions): Promise<InitKloProjectResult> {
  const projectDir = resolve(options.projectDir);
  const projectName = options.projectName?.trim() || basename(projectDir) || 'klo-project';
  const authorName = options.authorName ?? 'klo';
  const authorEmail = options.authorEmail ?? 'klo@example.com';
  const logger = options.logger ?? noopLogger;
  const configPath = join(projectDir, 'klo.yaml');

  await fs.mkdir(projectDir, { recursive: true });
  if (!options.force && (await fileExists(configPath))) {
    throw new Error(`Project already contains klo.yaml: ${configPath}`);
  }

  const config = buildDefaultKloProjectConfig(projectName);
  const runtime = await createRuntime(projectDir, config, authorName, authorEmail, logger);

  await writeProjectFile(projectDir, 'klo.yaml', serializeKloProjectConfig(config));
  await fs.mkdir(join(projectDir, '.klo/cache'), { recursive: true });
  for (const file of TRACKED_SCAFFOLD_FILES) {
    await writeProjectFile(projectDir, file.path, file.content);
  }

  const commit = await runtime.git.commitFiles(
    ['klo.yaml', ...TRACKED_SCAFFOLD_FILES.map((file) => file.path)],
    `Initialize KLO project: ${projectName}`,
    authorName,
    authorEmail,
  );

  return {
    ...runtime,
    commitHash: commit.commitHash,
  };
}

export async function loadKloProject(options: LoadKloProjectOptions): Promise<KloLocalProject> {
  const projectDir = resolve(options.projectDir);
  const authorName = options.authorName ?? 'klo';
  const authorEmail = options.authorEmail ?? 'klo@example.com';
  const logger = options.logger ?? noopLogger;
  const configPath = join(projectDir, 'klo.yaml');
  const raw = await fs.readFile(configPath, 'utf-8');
  const config = parseKloProjectConfig(raw);
  return createRuntime(projectDir, config, authorName, authorEmail, logger);
}

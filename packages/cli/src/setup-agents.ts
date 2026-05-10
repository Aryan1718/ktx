import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { cancel, isCancel, multiselect, select } from '@clack/prompts';
import { loadKloProject, markKloSetupStepComplete, serializeKloProjectConfig } from '@klo/context/project';
import type { KloCliIo } from './cli-runtime.js';
import { withMenuOptionsSpacing, withMultiselectNavigation } from './prompt-navigation.js';
import { withSetupInterruptConfirmation } from './setup-interrupt.js';

export type KloAgentTarget = 'claude-code' | 'codex' | 'cursor' | 'opencode' | 'universal';
export type KloAgentScope = 'project' | 'global';
export type KloAgentInstallMode = 'cli' | 'mcp' | 'both';

export interface KloSetupAgentsArgs {
  projectDir: string;
  inputMode: 'auto' | 'disabled';
  yes: boolean;
  agents: boolean;
  target?: KloAgentTarget;
  scope: KloAgentScope;
  mode: KloAgentInstallMode;
  skipAgents: boolean;
}

export type KloSetupAgentsResult =
  | {
      status: 'ready';
      projectDir: string;
      installs: Array<{ target: KloAgentTarget; scope: KloAgentScope; mode: KloAgentInstallMode }>;
    }
  | { status: 'skipped'; projectDir: string }
  | { status: 'back'; projectDir: string }
  | { status: 'missing-input'; projectDir: string }
  | { status: 'failed'; projectDir: string };

export interface KloAgentInstallManifest {
  version: 1;
  projectDir: string;
  installedAt: string;
  installs: Array<{ target: KloAgentTarget; scope: KloAgentScope; mode: KloAgentInstallMode }>;
  entries: Array<{ kind: 'file'; path: string } | { kind: 'json-key'; path: string; jsonPath: string[] }>;
}

type InstallEntry = KloAgentInstallManifest['entries'][number];

export function agentInstallManifestPath(projectDir: string): string {
  return join(resolve(projectDir), '.klo/agents/install-manifest.json');
}

export function plannedKloAgentFiles(input: {
  projectDir: string;
  target: KloAgentTarget;
  scope: KloAgentScope;
  mode: KloAgentInstallMode;
}): InstallEntry[] {
  if (input.scope === 'global') {
    if (input.target === 'claude-code') {
      return [{ kind: 'file', path: join(process.env.HOME ?? '', '.claude/skills/klo/SKILL.md') }];
    }
    if (input.target === 'codex') {
      return [
        { kind: 'file', path: join(process.env.CODEX_HOME ?? join(process.env.HOME ?? '', '.codex'), 'skills/klo/SKILL.md') },
      ];
    }
    throw new Error(`Global ${input.target} installation is not supported; use --project.`);
  }

  const root = resolve(input.projectDir);
  const cliEntries: Partial<Record<KloAgentTarget, InstallEntry>> = {
    'claude-code': { kind: 'file', path: join(root, '.claude/skills/klo/SKILL.md') },
    codex: { kind: 'file', path: join(root, '.agents/skills/klo/SKILL.md') },
    cursor: { kind: 'file', path: join(root, '.cursor/rules/klo.mdc') },
    opencode: { kind: 'file', path: join(root, '.opencode/commands/klo.md') },
    universal: { kind: 'file', path: join(root, '.agents/skills/klo/SKILL.md') },
  };
  const mcpEntries: Record<KloAgentTarget, InstallEntry> = {
    'claude-code': { kind: 'json-key', path: join(root, '.mcp.json'), jsonPath: ['mcpServers', 'klo'] },
    codex: { kind: 'json-key', path: join(root, '.agents/mcp/klo.json'), jsonPath: ['mcpServers', 'klo'] },
    cursor: { kind: 'json-key', path: join(root, '.cursor/mcp.json'), jsonPath: ['mcpServers', 'klo'] },
    opencode: { kind: 'json-key', path: join(root, '.opencode/mcp.json'), jsonPath: ['mcpServers', 'klo'] },
    universal: { kind: 'json-key', path: join(root, '.agents/mcp/klo.json'), jsonPath: ['mcpServers', 'klo'] },
  };
  return [
    ...(input.mode === 'cli' || input.mode === 'both' ? [cliEntries[input.target]] : []),
    ...(input.mode === 'mcp' || input.mode === 'both' ? [mcpEntries[input.target]] : []),
  ].filter((entry): entry is InstallEntry => entry !== undefined);
}

function cliInstructionContent(input: { projectDir: string; target: KloAgentTarget }): string {
  return [
    '---',
    'name: klo',
    'description: Use local KLO semantic context, wiki knowledge, and safe SQL execution for this project.',
    '---',
    '',
    '# KLO Local Context',
    '',
    `Use this project with \`--project-dir ${input.projectDir}\`.`,
    '',
    'Agents must not print secrets, credential references, environment variable values, or file contents from `.klo/secrets`.',
    '',
    'Available commands:',
    '',
    `- \`klo agent context --json --project-dir ${input.projectDir}\``,
    `- \`klo agent sl list --json --project-dir ${input.projectDir}\``,
    `- \`klo agent sl read <sourceName> --json --project-dir ${input.projectDir}\``,
    `- \`klo agent sl query --json --project-dir ${input.projectDir} --connection-id <id> --query-file <path> --execute --max-rows 100\``,
    `- \`klo agent wiki search <query> --json --project-dir ${input.projectDir}\``,
    `- \`klo agent wiki read <pageId> --json --project-dir ${input.projectDir}\``,
    `- \`klo agent sql execute --json --project-dir ${input.projectDir} --connection-id <id> --sql-file <path> --max-rows 100\``,
    '',
    'SQL execution is read-only, requires an explicit row limit, and should use the smallest useful limit.',
    '',
  ].join('\n');
}

function mcpConfig(projectDir: string): Record<string, unknown> {
  return {
    command: 'klo',
    args: ['--project-dir', projectDir, 'serve', '--mcp', 'stdio', '--semantic-compute', '--execute-queries'],
    env: {},
  };
}

async function writeJsonKey(path: string, jsonPath: string[], value: Record<string, unknown>): Promise<void> {
  let root: Record<string, unknown> = {};
  try {
    root = JSON.parse(await readFile(path, 'utf-8')) as Record<string, unknown>;
  } catch {
    root = {};
  }
  let cursor = root;
  for (const segment of jsonPath.slice(0, -1)) {
    const next = cursor[segment];
    if (!next || typeof next !== 'object' || Array.isArray(next)) cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[jsonPath.at(-1) as string] = value;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(root, null, 2)}\n`, 'utf-8');
}

async function removeJsonKey(path: string, jsonPath: string[]): Promise<void> {
  const root = JSON.parse(await readFile(path, 'utf-8')) as Record<string, unknown>;
  let cursor: Record<string, unknown> = root;
  for (const segment of jsonPath.slice(0, -1)) {
    const next = cursor[segment];
    if (!next || typeof next !== 'object' || Array.isArray(next)) return;
    cursor = next as Record<string, unknown>;
  }
  delete cursor[jsonPath.at(-1) as string];
  await writeFile(path, `${JSON.stringify(root, null, 2)}\n`, 'utf-8');
}

export async function readKloAgentInstallManifest(projectDir: string): Promise<KloAgentInstallManifest | null> {
  try {
    return JSON.parse(await readFile(agentInstallManifestPath(projectDir), 'utf-8')) as KloAgentInstallManifest;
  } catch {
    return null;
  }
}

async function writeManifest(projectDir: string, manifest: KloAgentInstallManifest): Promise<void> {
  const path = agentInstallManifestPath(projectDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
}

function entryKey(entry: InstallEntry): string {
  return entry.kind === 'json-key' ? `${entry.kind}:${entry.path}:${entry.jsonPath.join('.')}` : `${entry.kind}:${entry.path}`;
}

function mergeManifest(
  projectDir: string,
  existing: KloAgentInstallManifest | null,
  installs: KloAgentInstallManifest['installs'],
  entries: InstallEntry[],
): KloAgentInstallManifest {
  const installMap = new Map<string, KloAgentInstallManifest['installs'][number]>();
  for (const install of [...(existing?.installs ?? []), ...installs]) {
    installMap.set(`${install.target}:${install.scope}:${install.mode}`, install);
  }
  const entryMap = new Map<string, InstallEntry>();
  for (const entry of [...(existing?.entries ?? []), ...entries]) {
    entryMap.set(entryKey(entry), entry);
  }
  return {
    version: 1,
    projectDir,
    installedAt: new Date().toISOString(),
    installs: [...installMap.values()],
    entries: [...entryMap.values()],
  };
}

export async function removeKloAgentInstall(projectDir: string, io: KloCliIo): Promise<number> {
  const manifest = await readKloAgentInstallManifest(projectDir);
  if (!manifest) {
    io.stdout.write('No KLO agent installation manifest found.\n');
    return 0;
  }
  for (const entry of manifest.entries) {
    if (entry.kind === 'file') await rm(entry.path, { force: true });
    if (entry.kind === 'json-key') await removeJsonKey(entry.path, entry.jsonPath).catch(() => undefined);
  }
  await rm(agentInstallManifestPath(projectDir), { force: true });
  io.stdout.write('Removed KLO agent integration files from manifest.\n');
  return 0;
}

export interface KloSetupAgentsPromptAdapter {
  select(options: { message: string; options: Array<{ value: string; label: string }> }): Promise<string>;
  multiselect(options: {
    message: string;
    options: Array<{ value: string; label: string }>;
    required?: boolean;
  }): Promise<string[]>;
  cancel(message: string): void;
}

export interface KloSetupAgentsDeps {
  prompts?: KloSetupAgentsPromptAdapter;
}

function createPromptAdapter(): KloSetupAgentsPromptAdapter {
  return {
    async select(options) {
      const value = await withSetupInterruptConfirmation(() => select(withMenuOptionsSpacing(options)));
      if (isCancel(value)) {
        cancel('Setup cancelled.');
        return 'back';
      }
      return String(value);
    },
    async multiselect(options) {
      const value = await withSetupInterruptConfirmation(() => multiselect(withMenuOptionsSpacing(options)));
      if (isCancel(value)) {
        cancel('Setup cancelled.');
        return ['back'];
      }
      return [...value] as string[];
    },
    cancel(message) {
      cancel(message);
    },
  };
}

async function installTarget(input: {
  projectDir: string;
  target: KloAgentTarget;
  scope: KloAgentScope;
  mode: KloAgentInstallMode;
}): Promise<InstallEntry[]> {
  const entries = plannedKloAgentFiles(input);
  for (const entry of entries) {
    if (entry.kind === 'file') {
      await mkdir(dirname(entry.path), { recursive: true });
      await writeFile(entry.path, cliInstructionContent({ projectDir: input.projectDir, target: input.target }), 'utf-8');
    } else {
      await writeJsonKey(entry.path, entry.jsonPath, mcpConfig(input.projectDir));
    }
  }
  return entries;
}

async function markAgentsComplete(projectDir: string): Promise<void> {
  const project = await loadKloProject({ projectDir });
  await writeFile(project.configPath, serializeKloProjectConfig(markKloSetupStepComplete(project.config, 'agents')), 'utf-8');
}

export async function runKloSetupAgentsStep(
  args: KloSetupAgentsArgs,
  io: KloCliIo,
  deps: KloSetupAgentsDeps = {},
): Promise<KloSetupAgentsResult> {
  if (args.skipAgents) {
    io.stdout.write('Agent integration skipped.\n');
    return { status: 'skipped', projectDir: args.projectDir };
  }
  if (!args.agents && args.inputMode === 'disabled') {
    return { status: 'skipped', projectDir: args.projectDir };
  }

  const prompts = deps.prompts ?? createPromptAdapter();
  const mode =
    args.inputMode === 'disabled'
      ? args.mode
      : ((await prompts.select({
          message: 'How should agents use this KLO project?',
          options: [
            { value: 'cli', label: 'CLI tools and skills' },
            { value: 'mcp', label: 'MCP server config' },
            { value: 'both', label: 'Both' },
            { value: 'skip', label: 'Skip' },
            { value: 'back', label: 'Back' },
          ],
        })) as KloAgentInstallMode | 'skip' | 'back');
  if (mode === 'back') return { status: 'back', projectDir: args.projectDir };
  if (mode === 'skip') return { status: 'skipped', projectDir: args.projectDir };

  const targets =
    args.target !== undefined
      ? [args.target]
      : args.inputMode === 'disabled'
        ? []
        : ((await prompts.multiselect({
            message: withMultiselectNavigation('Which agent targets should KLO install?'),
            options: [
              { value: 'claude-code', label: 'Claude Code' },
              { value: 'codex', label: 'Codex' },
              { value: 'cursor', label: 'Cursor' },
              { value: 'opencode', label: 'OpenCode' },
              { value: 'universal', label: 'Universal .agents' },
              { value: 'back', label: 'Back' },
            ],
            required: true,
          })) as KloAgentTarget[]);
  if (targets.includes('back' as KloAgentTarget)) return { status: 'back', projectDir: args.projectDir };
  if (targets.length === 0) {
    io.stderr.write('Missing agent target: pass --target or use interactive setup.\n');
    return { status: 'missing-input', projectDir: args.projectDir };
  }

  const installs = targets.map((target) => ({ target, scope: args.scope, mode }));
  const entries: InstallEntry[] = [];
  try {
    for (const install of installs) entries.push(...(await installTarget({ projectDir: args.projectDir, ...install })));
    await writeManifest(args.projectDir, mergeManifest(args.projectDir, await readKloAgentInstallManifest(args.projectDir), installs, entries));
    await markAgentsComplete(args.projectDir);
    io.stdout.write(`Agent integration installed for ${installs.map((install) => install.target).join(', ')}.\n`);
    return { status: 'ready', projectDir: args.projectDir, installs };
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return { status: 'failed', projectDir: args.projectDir };
  }
}

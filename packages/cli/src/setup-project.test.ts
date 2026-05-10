import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initKloProject, parseKloProjectConfig } from '@klo/context/project';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type KloSetupProjectPromptAdapter, runKloSetupProjectStep } from './setup-project.js';

function makeIo(options: { stdoutIsTty?: boolean } = {}) {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: {
        isTTY: options.stdoutIsTty,
        write: (chunk: string) => {
          stdout += chunk;
        },
      },
      stderr: {
        write: (chunk: string) => {
          stderr += chunk;
        },
      },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

function makePromptAdapter(options: { choice?: string; choices?: string[]; textValue?: string; textValues?: string[] }) {
  const choices = [...(options.choices ?? (options.choice ? [options.choice] : []))];
  const textValues = [...(options.textValues ?? (options.textValue !== undefined ? [options.textValue] : []))];
  return {
    select: vi.fn(async () => choices.shift() ?? 'exit'),
    text: vi.fn(async () => textValues.shift() ?? ''),
    cancel: vi.fn(),
  } satisfies KloSetupProjectPromptAdapter;
}

describe('setup project step', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'klo-setup-project-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates a new project with --new and marks the project step complete', async () => {
    const projectDir = join(tempDir, 'warehouse');
    const testIo = makeIo();

    const result = await runKloSetupProjectStep(
      { projectDir, mode: 'new', inputMode: 'disabled', yes: false },
      testIo.io,
    );

    expect(result.status).toBe('ready');
    expect(result.projectDir).toBe(projectDir);
    const config = parseKloProjectConfig(await readFile(join(projectDir, 'klo.yaml'), 'utf-8'));
    expect(config.setup?.completed_steps).toEqual(['project']);
    await expect(stat(join(projectDir, '.git'))).resolves.toBeDefined();
    await expect(readFile(join(projectDir, '.klo/.gitignore'), 'utf-8')).resolves.toContain('secrets/');
    expect(testIo.stdout()).toContain(`Project: ${projectDir}`);
    expect(testIo.stderr()).toBe('');
  });

  it('loads an existing project with --existing and preserves existing setup metadata', async () => {
    const projectDir = join(tempDir, 'warehouse');
    await initKloProject({ projectDir, projectName: 'warehouse' });
    await writeFile(
      join(projectDir, 'klo.yaml'),
      [
        'project: warehouse',
        'setup:',
        '  database_connection_ids:',
        '    - warehouse',
        '  completed_steps:',
        '    - llm',
        'connections: {}',
      ].join('\n'),
      'utf-8',
    );

    const result = await runKloSetupProjectStep(
      { projectDir, mode: 'existing', inputMode: 'disabled', yes: false },
      makeIo().io,
    );

    expect(result.status).toBe('ready');
    const config = parseKloProjectConfig(await readFile(join(projectDir, 'klo.yaml'), 'utf-8'));
    expect(config.setup).toEqual({
      database_connection_ids: ['warehouse'],
      completed_steps: ['llm', 'project'],
    });
  });

  it('creates a missing auto-mode project only when --yes is present in no-input mode', async () => {
    const projectDir = join(tempDir, 'warehouse');
    const rejectedIo = makeIo();
    const acceptedIo = makeIo();

    await expect(
      runKloSetupProjectStep({ projectDir, mode: 'auto', inputMode: 'disabled', yes: false }, rejectedIo.io),
    ).resolves.toMatchObject({ status: 'missing-input' });
    expect(rejectedIo.stderr()).toContain('Missing setup choice: pass --new or --yes');
    await expect(stat(join(projectDir, 'klo.yaml'))).rejects.toThrow();

    await expect(
      runKloSetupProjectStep({ projectDir, mode: 'auto', inputMode: 'disabled', yes: true }, acceptedIo.io),
    ).resolves.toMatchObject({ status: 'ready', projectDir });
    await expect(stat(join(projectDir, 'klo.yaml'))).resolves.toBeDefined();
  });

  it('fails --existing clearly when klo.yaml is missing', async () => {
    const projectDir = join(tempDir, 'warehouse');
    const testIo = makeIo();

    await expect(
      runKloSetupProjectStep({ projectDir, mode: 'existing', inputMode: 'disabled', yes: false }, testIo.io),
    ).resolves.toMatchObject({ status: 'missing-input' });

    expect(testIo.stderr()).toContain(`No existing KLO project found at ${projectDir}`);
  });

  it('prompts to use the current directory and creates a project in interactive auto mode', async () => {
    const projectDir = join(tempDir, 'warehouse');
    const prompts = makePromptAdapter({ choice: 'current' });
    const testIo = makeIo({ stdoutIsTty: true });

    const result = await runKloSetupProjectStep(
      { projectDir, mode: 'auto', inputMode: 'auto', yes: false },
      testIo.io,
      { prompts },
    );

    expect(result.status).toBe('ready');
    expect(result.projectDir).toBe(projectDir);
    expect(prompts.select).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Which KLO project should setup use?',
        options: [
          expect.objectContaining({ value: 'current', label: 'Use current directory' }),
          expect.objectContaining({ value: 'new', label: 'Create a new project folder' }),
          expect.objectContaining({ value: 'exit', label: 'Exit' }),
        ],
      }),
    );
    expect(prompts.text).not.toHaveBeenCalled();
    const config = parseKloProjectConfig(await readFile(join(projectDir, 'klo.yaml'), 'utf-8'));
    expect(config.setup?.completed_steps).toEqual(['project']);
  });

  it('offers an absolute default destination for a new project folder', async () => {
    const startDir = join(tempDir, 'start');
    const projectDir = join(startDir, 'klo-project');
    const prompts = makePromptAdapter({ choices: ['new', 'default', 'create'] });
    const testIo = makeIo({ stdoutIsTty: true });

    const result = await runKloSetupProjectStep(
      { projectDir: startDir, mode: 'auto', inputMode: 'auto', yes: false },
      testIo.io,
      { prompts },
    );

    expect(result.status).toBe('ready');
    expect(result.projectDir).toBe(projectDir);
    expect(prompts.select).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        message: 'Where should KLO create the project?',
        options: [
          expect.objectContaining({
            value: 'default',
            label: `Create the default project folder: ${projectDir}`,
          }),
          expect.objectContaining({ value: 'custom', label: 'Enter a custom path' }),
          expect.objectContaining({ value: 'back', label: 'Back' }),
        ],
      }),
    );
    expect(prompts.select).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ message: `Create KLO project at ${projectDir}?` }),
    );
    expect(prompts.text).not.toHaveBeenCalled();
    expect(result.status === 'ready' ? result.project.config.project : '').toBe('klo-project');
    expect(testIo.stdout()).toContain(`KLO will create:\n  ${projectDir}`);
    await expect(stat(join(projectDir, 'klo.yaml'))).resolves.toBeDefined();
  });

  it('prompts for a custom path and resolves it inside the current setup directory', async () => {
    const startDir = join(tempDir, 'start');
    const projectDir = join(startDir, 'analytics-klo');
    const prompts = makePromptAdapter({ choices: ['new', 'custom', 'create'], textValue: 'analytics-klo' });

    const result = await runKloSetupProjectStep(
      { projectDir: startDir, mode: 'auto', inputMode: 'auto', yes: false },
      makeIo({ stdoutIsTty: true }).io,
      { prompts },
    );

    expect(result.status).toBe('ready');
    expect(result.projectDir).toBe(projectDir);
    expect(prompts.text).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Project folder path\nPress Escape to go back.\n',
        placeholder: './analytics-klo, ~/analytics-klo, or /Users/you/projects/analytics-klo',
      }),
    );
    await expect(stat(join(projectDir, 'klo.yaml'))).resolves.toBeDefined();
  });

  it('expands a custom home-directory path before creating a new project', async () => {
    const startDir = join(tempDir, 'start');
    const homeDir = join(tempDir, 'home');
    const projectDir = join(homeDir, 'analytics-klo');
    const prompts = makePromptAdapter({ choices: ['new', 'custom', 'create'], textValue: '~/analytics-klo' });

    const result = await runKloSetupProjectStep(
      { projectDir: startDir, mode: 'auto', inputMode: 'auto', yes: false },
      makeIo({ stdoutIsTty: true }).io,
      { prompts, homeDir },
    );

    expect(result.status).toBe('ready');
    expect(result.projectDir).toBe(projectDir);
    await expect(stat(join(projectDir, 'klo.yaml'))).resolves.toBeDefined();
  });

  it('confirms a custom new project path and lets Back return to the project choice', async () => {
    const startDir = join(tempDir, 'start');
    const homeDir = join(tempDir, 'home');
    const customProjectDir = join(homeDir, 'analytics-klo');
    const prompts = makePromptAdapter({
      choices: ['new', 'custom', 'back', 'exit'],
      textValue: '~/analytics-klo',
    });

    const result = await runKloSetupProjectStep(
      { projectDir: startDir, mode: 'auto', inputMode: 'auto', yes: false },
      makeIo({ stdoutIsTty: true }).io,
      { prompts, homeDir },
    );

    expect(result.status).toBe('cancelled');
    expect(result.projectDir).toBe(startDir);
    expect(prompts.select).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        message: `Create KLO project at ${customProjectDir}?`,
        options: [
          expect.objectContaining({ value: 'create', label: 'Create project' }),
          expect.objectContaining({ value: 'choose-another', label: 'Choose another folder' }),
          expect.objectContaining({ value: 'back', label: 'Back' }),
        ],
      }),
    );
    expect(prompts.select).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ message: 'Which KLO project should setup use?' }),
    );
    await expect(stat(join(customProjectDir, 'klo.yaml'))).rejects.toThrow();
  });

  it('rejects an empty new folder path without creating a project in the process cwd', async () => {
    const startDir = join(tempDir, 'start');
    const prompts = makePromptAdapter({ choices: ['new', 'custom'], textValue: '   ' });
    const initProject = vi.fn(async () => {
      throw new Error('initProject should not run for an empty path');
    });
    const testIo = makeIo({ stdoutIsTty: true });

    await expect(
      runKloSetupProjectStep(
        { projectDir: startDir, mode: 'auto', inputMode: 'auto', yes: false },
        testIo.io,
        { prompts, initProject },
      ),
    ).resolves.toMatchObject({ status: 'missing-input', projectDir: startDir });

    expect(initProject).not.toHaveBeenCalled();
    expect(testIo.stderr()).toContain(
      'Enter a relative path like ./analytics-klo, a home path like ~/analytics-klo, or an absolute path.',
    );
  });

  it('confirms before creating KLO files inside an existing non-empty folder', async () => {
    const startDir = join(tempDir, 'start');
    const projectDir = join(startDir, 'analytics-klo');
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, 'README.md'), 'Existing project notes\n', 'utf-8');
    const prompts = makePromptAdapter({ choices: ['new', 'custom', 'use-existing'], textValue: 'analytics-klo' });

    const result = await runKloSetupProjectStep(
      { projectDir: startDir, mode: 'auto', inputMode: 'auto', yes: false },
      makeIo({ stdoutIsTty: true }).io,
      { prompts },
    );

    expect(result.status).toBe('ready');
    expect(result.projectDir).toBe(projectDir);
    expect(prompts.select).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        message: `That folder already exists and is not empty: ${projectDir}`,
        options: expect.arrayContaining([
          expect.objectContaining({ value: 'use-existing', label: 'Yes, create KLO files there' }),
          expect.objectContaining({ value: 'choose-another', label: 'Choose another folder' }),
        ]),
      }),
    );
    await expect(readFile(join(projectDir, 'README.md'), 'utf-8')).resolves.toBe('Existing project notes\n');
    await expect(stat(join(projectDir, 'klo.yaml'))).resolves.toBeDefined();
  });

  it('prompts to exit and returns cancelled in interactive auto mode', async () => {
    const projectDir = join(tempDir, 'warehouse');
    const prompts = makePromptAdapter({ choice: 'exit' });

    await expect(
      runKloSetupProjectStep(
        { projectDir, mode: 'auto', inputMode: 'auto', yes: false },
        makeIo({ stdoutIsTty: true }).io,
        { prompts },
      ),
    ).resolves.toMatchObject({ status: 'cancelled', projectDir });

    expect(prompts.cancel).toHaveBeenCalledWith('Setup cancelled.');
    expect(prompts.text).not.toHaveBeenCalled();
    await expect(stat(join(projectDir, 'klo.yaml'))).rejects.toThrow();
  });
});

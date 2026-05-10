import { join } from 'node:path';
import type { KloLocalProject } from './project.js';

export function kloLocalStateDbPath(project: Pick<KloLocalProject, 'projectDir'>): string {
  return join(project.projectDir, '.klo', 'db.sqlite');
}

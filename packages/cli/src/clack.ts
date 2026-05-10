import { spinner } from '@clack/prompts';

export interface KloCliSpinner {
  start(message: string): void;
  stop(message: string): void;
  error(message: string): void;
}

export function createClackSpinner(): KloCliSpinner {
  return spinner();
}

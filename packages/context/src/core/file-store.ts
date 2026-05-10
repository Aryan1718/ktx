export interface KloFileWriteResult {
  commitHash?: string | null;
  [key: string]: unknown;
}

export interface KloFileReadResult {
  content: string;
  [key: string]: unknown;
}

export interface KloFileListResult {
  files: string[];
}

export interface KloFileHistoryEntry {
  sha?: string;
  message?: string;
  author?: string;
  date?: string | Date;
  [key: string]: unknown;
}

export interface KloFileStorePort<TSelf = unknown> {
  writeFile(
    path: string,
    content: string,
    author: string,
    authorEmail: string,
    commitMessage: string,
    options?: { skipLock?: boolean },
  ): Promise<KloFileWriteResult>;
  readFile(path: string): Promise<KloFileReadResult>;
  deleteFile(
    path: string,
    author: string,
    authorEmail: string,
    commitMessage: string,
    options?: { skipLock?: boolean },
  ): Promise<KloFileWriteResult | null>;
  listFiles(path: string, recursive?: boolean): Promise<KloFileListResult>;
  getFileHistory(path: string): Promise<KloFileHistoryEntry[] | unknown>;
  forWorktree(workdir: string): TSelf;
}

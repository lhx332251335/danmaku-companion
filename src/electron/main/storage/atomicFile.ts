import fs from "node:fs/promises";
import path from "node:path";

/** Windows antivirus and indexers briefly lock files, which makes fs calls fail with these codes. */
const LOCKED_FILE_CODES: ReadonlySet<string> = new Set(["EPERM", "EBUSY", "EACCES"]);
const LOCKED_FILE_RETRY_DELAYS_MS: readonly number[] = [10, 30, 60, 120, 250];

type RenameFn = (from: string, to: string) => Promise<void>;

export interface RenameRetryOptions {
  rename?: RenameFn;
  retryDelaysMs?: readonly number[];
}

export interface AtomicWriteOptions extends RenameRetryOptions {
  /** Copy the file being replaced here first (best effort). */
  backupPath?: string;
}

export function errnoCode(error: unknown): string | undefined {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" ? code : undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A timestamp that is safe in Windows file names. */
export function fileTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function retryWhileLocked<T>(
  operation: () => Promise<T>,
  retryDelaysMs: readonly number[],
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const wait = retryDelaysMs[attempt];
      if (wait === undefined || !LOCKED_FILE_CODES.has(errnoCode(error) ?? "")) {
        throw error;
      }
      await delay(wait);
    }
  }
}

/** Reads a UTF-8 file; undefined only when it does not exist. Other errors are thrown. */
export async function readTextIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await retryWhileLocked(
      () => fs.readFile(filePath, "utf8"),
      LOCKED_FILE_RETRY_DELAYS_MS,
    );
  } catch (error) {
    if (errnoCode(error) === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export function renameWithRetry(
  from: string,
  to: string,
  { rename = fs.rename, retryDelaysMs = LOCKED_FILE_RETRY_DELAYS_MS }: RenameRetryOptions = {},
): Promise<void> {
  return retryWhileLocked(() => rename(from, to), retryDelaysMs);
}

async function writeAndSync(filePath: string, data: string): Promise<void> {
  const handle = await fs.open(filePath, "w");
  try {
    await handle.writeFile(data, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function backupFile(filePath: string, backupPath: string): Promise<void> {
  try {
    await fs.copyFile(filePath, backupPath);
  } catch (error) {
    if (errnoCode(error) !== "ENOENT") {
      console.warn(`Failed to back up ${filePath}.`, error);
    }
  }
}

/** Writes a temp file, flushes it, then renames it over the target so readers never see a partial file. */
export async function writeFileAtomic(
  filePath: string,
  data: string,
  options: AtomicWriteOptions = {},
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  // Per process: without a single-instance lock, a second app instance may write the same file.
  // One instance (single-instance lock) and one queued writer per file, so a fixed name is safe,
  // and a temp file left by a killed process is simply reused by the next write.
  const tempPath = `${filePath}.tmp`;
  try {
    await writeAndSync(tempPath, data);
    if (options.backupPath) {
      await backupFile(filePath, options.backupPath);
    }
    await renameWithRetry(tempPath, filePath, options);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Runs async tasks one at a time in call order; a failed task does not block later ones. */
export class WriteQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;

  run<T>(task: () => Promise<T>): Promise<T> {
    this.pending += 1;
    const result = this.tail.then(task).finally(() => {
      this.pending -= 1;
    });
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  hasPending(): boolean {
    return this.pending > 0;
  }

  /** Resolves once every task queued so far has settled. Never rejects. */
  flush(): Promise<void> {
    return this.tail;
  }
}

import { mkdir, readFile, rename, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import type { DeliveryLog } from "./types.js";

type ProcessedRecord = {
  status: "processing" | "sent" | "failed";
  mediaId?: string;
  keyword?: string;
  updatedAt: string;
  error?: string;
};

type StoreFile = {
  comments: Record<string, ProcessedRecord>;
};

export class FileStore {
  private data: StoreFile = { comments: {} };
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly dedupeStorePath: string,
    private readonly eventLogPath: string
  ) {}

  async init(): Promise<void> {
    await mkdir(path.dirname(this.dedupeStorePath), { recursive: true });
    await mkdir(path.dirname(this.eventLogPath), { recursive: true });

    try {
      const raw = await readFile(this.dedupeStorePath, "utf8");
      this.data = JSON.parse(raw) as StoreFile;
      this.data.comments ??= {};
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
      await this.flush();
    }
  }

  async claimComment(commentId: string, mediaId: string | undefined, keyword: string): Promise<boolean> {
    return this.withLock(async () => {
      const existing = this.data.comments[commentId];
      if (existing?.status === "sent" || existing?.status === "processing") {
        return false;
      }

      this.data.comments[commentId] = {
        status: "processing",
        mediaId,
        keyword,
        updatedAt: new Date().toISOString()
      };
      await this.flush();
      return true;
    });
  }

  async markCommentSent(commentId: string): Promise<void> {
    await this.withLock(async () => {
      const existing = this.data.comments[commentId];
      this.data.comments[commentId] = {
        ...existing,
        status: "sent",
        updatedAt: new Date().toISOString()
      };
      await this.flush();
    });
  }

  async markCommentFailed(commentId: string, errorMessage: string): Promise<void> {
    await this.withLock(async () => {
      const existing = this.data.comments[commentId];
      this.data.comments[commentId] = {
        ...existing,
        status: "failed",
        error: errorMessage,
        updatedAt: new Date().toISOString()
      };
      await this.flush();
    });
  }

  async appendLog(event: DeliveryLog): Promise<void> {
    await this.withLock(async () => {
      await appendFile(this.eventLogPath, `${JSON.stringify(event)}\n`, "utf8");
    });
  }

  private async flush(): Promise<void> {
    const tmpPath = `${this.dedupeStorePath}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
    await rename(tmpPath, this.dedupeStorePath);
  }

  private withLock<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

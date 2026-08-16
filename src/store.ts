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
  actions?: Record<string, ProcessedRecord>;
  counters?: Record<string, number>;
  senderTemplates?: Record<string, string[]>;
  senderRuleLastSentAt?: Record<string, string>;
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

  async claimAction(actionKey: string, metadata?: { mediaId?: string; keyword?: string }): Promise<boolean> {
    return this.withLock(async () => {
      this.data.actions ??= {};
      const existing = this.data.actions[actionKey];
      if (existing?.status === "sent" || existing?.status === "processing") {
        return false;
      }

      this.data.actions[actionKey] = {
        status: "processing",
        mediaId: metadata?.mediaId,
        keyword: metadata?.keyword,
        updatedAt: new Date().toISOString()
      };
      await this.flush();
      return true;
    });
  }

  async markActionSent(actionKey: string): Promise<void> {
    await this.withLock(async () => {
      this.data.actions ??= {};
      const existing = this.data.actions[actionKey];
      this.data.actions[actionKey] = {
        ...existing,
        status: "sent",
        updatedAt: new Date().toISOString()
      };
      await this.flush();
    });
  }

  async markActionFailed(actionKey: string, errorMessage: string): Promise<void> {
    await this.withLock(async () => {
      this.data.actions ??= {};
      const existing = this.data.actions[actionKey];
      this.data.actions[actionKey] = {
        ...existing,
        status: "failed",
        error: errorMessage,
        updatedAt: new Date().toISOString()
      };
      await this.flush();
    });
  }

  async getCounter(counterKey: string): Promise<number> {
    return this.withLock(async () => {
      this.data.counters ??= {};
      return this.data.counters[counterKey] ?? 0;
    });
  }

  async incrementCounter(counterKey: string): Promise<void> {
    await this.withLock(async () => {
      this.data.counters ??= {};
      this.data.counters[counterKey] = (this.data.counters[counterKey] ?? 0) + 1;
      await this.flush();
    });
  }

  async getSenderTemplateHistory(senderId: string, ruleId: string): Promise<string[]> {
    return this.withLock(async () => {
      this.data.senderTemplates ??= {};
      return this.data.senderTemplates[`${senderId}:${ruleId}`] ?? [];
    });
  }

  async rememberSenderTemplate(senderId: string, ruleId: string, template: string): Promise<void> {
    await this.withLock(async () => {
      this.data.senderTemplates ??= {};
      const key = `${senderId}:${ruleId}`;
      const existing = this.data.senderTemplates[key] ?? [];
      this.data.senderTemplates[key] = [...existing, template];
      await this.flush();
    });
  }

  async getSenderRuleLastSentAt(senderId: string, ruleId: string): Promise<string | undefined> {
    return this.withLock(async () => {
      this.data.senderRuleLastSentAt ??= {};
      return this.data.senderRuleLastSentAt[`${senderId}:${ruleId}`];
    });
  }

  async rememberSenderRuleSent(senderId: string, ruleId: string): Promise<void> {
    await this.withLock(async () => {
      this.data.senderRuleLastSentAt ??= {};
      this.data.senderRuleLastSentAt[`${senderId}:${ruleId}`] = new Date().toISOString();
      await this.flush();
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

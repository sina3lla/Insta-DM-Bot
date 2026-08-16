import type { AppConfig } from "./types.js";

type MetaApiErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

export type MetaSendResult = {
  ok: boolean;
  status: number;
  body: unknown;
  attempts: number;
};

const RETRYABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_GRAPH_CODES = new Set([1, 2, 4, 17, 32, 613]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());

  return null;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function isRetryable(status: number, body: unknown): boolean {
  if (RETRYABLE_HTTP_STATUSES.has(status)) return true;

  const graphCode = (body as MetaApiErrorBody | null)?.error?.code;
  return typeof graphCode === "number" && RETRYABLE_GRAPH_CODES.has(graphCode);
}

export class MetaClient {
  constructor(private readonly config: AppConfig) {}

  private async sendJson(url: URL, body: unknown): Promise<MetaSendResult> {
    const maxAttempts = 4;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.metaAccessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        });
      } catch (error) {
        if (attempt < maxAttempts) {
          await sleep(500 * 2 ** (attempt - 1));
          continue;
        }

        throw error;
      }

      const responseBody = await readResponseBody(response);
      if (response.ok) {
        return {
          ok: true,
          status: response.status,
          body: responseBody,
          attempts: attempt
        };
      }

      if (attempt < maxAttempts && isRetryable(response.status, responseBody)) {
        const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
        const backoff = retryAfter ?? 500 * 2 ** (attempt - 1);
        await sleep(backoff);
        continue;
      }

      return {
        ok: false,
        status: response.status,
        body: responseBody,
        attempts: attempt
      };
    }

    throw new Error("Unreachable private reply retry state");
  }

  async sendPrivateReply(commentId: string, messageText: string): Promise<MetaSendResult> {
    const url = new URL(
      `https://graph.instagram.com/${this.config.metaApiVersion}/${this.config.metaIgUserId}/messages`
    );

    return this.sendJson(url, {
      // Meta private replies use the comment ID as the recipient. This sends a DM to the commenter.
      recipient: {
        comment_id: commentId
      },
      message: {
        text: messageText
      }
    });
  }

  async replyToComment(commentId: string, messageText: string): Promise<MetaSendResult> {
    const url = new URL(`https://graph.instagram.com/${this.config.metaApiVersion}/${commentId}/replies`);
    return this.sendJson(url, { message: messageText });
  }

  async sendMessage(recipientId: string, messageText: string): Promise<MetaSendResult> {
    const url = new URL(
      `https://graph.instagram.com/${this.config.metaApiVersion}/${this.config.metaIgUserId}/messages`
    );

    return this.sendJson(url, {
      recipient: {
        id: recipientId
      },
      messaging_type: "RESPONSE",
      message: {
        text: messageText
      }
    });
  }

  async hideComment(commentId: string): Promise<MetaSendResult> {
    const url = new URL(`https://graph.instagram.com/${this.config.metaApiVersion}/${commentId}`);
    url.searchParams.set("hide", "true");
    return this.sendJson(url, {});
  }

  async deleteComment(commentId: string): Promise<MetaSendResult> {
    const url = new URL(`https://graph.instagram.com/${this.config.metaApiVersion}/${commentId}`);
    const maxAttempts = 4;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(url, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${this.config.metaAccessToken}`
          }
        });
      } catch (error) {
        if (attempt < maxAttempts) {
          await sleep(500 * 2 ** (attempt - 1));
          continue;
        }

        throw error;
      }

      const responseBody = await readResponseBody(response);
      if (response.ok) {
        return { ok: true, status: response.status, body: responseBody, attempts: attempt };
      }

      if (attempt < maxAttempts && isRetryable(response.status, responseBody)) {
        const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
        const backoff = retryAfter ?? 500 * 2 ** (attempt - 1);
        await sleep(backoff);
        continue;
      }

      return { ok: false, status: response.status, body: responseBody, attempts: attempt };
    }

    throw new Error("Unreachable delete comment retry state");
  }
}

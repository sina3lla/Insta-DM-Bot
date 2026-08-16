import express, { type Request, type Response } from "express";
import { loadConfig } from "./config.js";
import { findKeywordMatch } from "./keywordMatcher.js";
import { printLog } from "./logger.js";
import { MetaClient } from "./metaClient.js";
import { verifyMetaSignature } from "./metaSignature.js";
import { FileStore } from "./store.js";
import type { DeliveryLog, InstagramWebhookPayload } from "./types.js";
import { extractCommentEvents } from "./webhookParser.js";

const config = loadConfig();
const store = new FileStore(config.dedupeStorePath, config.eventLogPath);
const metaClient = new MetaClient(config);
const app = express();

function logEvent(event: Omit<DeliveryLog, "timestamp">): Promise<void> {
  const fullEvent: DeliveryLog = {
    timestamp: new Date().toISOString(),
    ...event
  };

  printLog(fullEvent);
  return store.appendLog(fullEvent);
}

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ ok: true });
});

app.get("/webhook", (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const verifyToken = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && verifyToken === config.metaVerifyToken && typeof challenge === "string") {
    res.status(200).send(challenge);
    return;
  }

  res.sendStatus(403);
});

app.post("/webhook", express.raw({ type: "application/json", limit: "1mb" }), async (req: Request, res: Response) => {
  const rawBody = req.body;
  if (!Buffer.isBuffer(rawBody)) {
    res.status(400).json({ error: "Expected application/json request body" });
    return;
  }

  if (config.verifyMetaSignatures) {
    const signature = req.header("x-hub-signature-256");
    if (!verifyMetaSignature(rawBody, signature, config.metaAppSecret)) {
      res.status(403).json({ error: "Invalid Meta webhook signature" });
      return;
    }
  }

  let payload: InstagramWebhookPayload;
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as InstagramWebhookPayload;
  } catch {
    res.status(400).json({ error: "Invalid JSON payload" });
    return;
  }

  const commentEvents = extractCommentEvents(payload);

  for (const event of commentEvents) {
    const match = findKeywordMatch(event.commentText, config.keywordResponses);
    if (!match) {
      await logEvent({
        mediaId: event.mediaId,
        commentId: event.commentId,
        dmSucceeded: false,
        status: "ignored",
        reason: "No configured keyword matched"
      });
      continue;
    }

    const claimed = await store.claimComment(event.commentId, event.mediaId, match.keyword);
    if (!claimed) {
      await logEvent({
        mediaId: event.mediaId,
        commentId: event.commentId,
        detectedKeyword: match.keyword,
        dmSucceeded: false,
        status: "duplicate",
        reason: "Comment already processed or currently processing"
      });
      continue;
    }

    try {
      const result = await metaClient.sendPrivateReply(event.commentId, match.responseText);
      if (result.ok) {
        await store.markCommentSent(event.commentId);
        await logEvent({
          mediaId: event.mediaId,
          commentId: event.commentId,
          detectedKeyword: match.keyword,
          dmSucceeded: true,
          status: "sent",
          metaStatus: result.status,
          metaResponse: result.body
        });
      } else {
        await store.markCommentFailed(event.commentId, JSON.stringify(result.body));
        await logEvent({
          mediaId: event.mediaId,
          commentId: event.commentId,
          detectedKeyword: match.keyword,
          dmSucceeded: false,
          status: "failed",
          reason: "Meta private reply API returned an error",
          metaStatus: result.status,
          metaResponse: result.body
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await store.markCommentFailed(event.commentId, message);
      await logEvent({
        mediaId: event.mediaId,
        commentId: event.commentId,
        detectedKeyword: match.keyword,
        dmSucceeded: false,
        status: "failed",
        reason: message
      });
    }
  }

  res.status(200).json({ received: true, comments: commentEvents.length });
});

await store.init();

app.listen(config.port, () => {
  console.log(`Instagram DM bot listening on port ${config.port}`);
});

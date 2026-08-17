import express, { type Request, type Response } from "express";
import { loadConfig } from "./config.js";
import { findKeywordMatch } from "./keywordMatcher.js";
import { printLog } from "./logger.js";
import { MetaClient } from "./metaClient.js";
import { verifyMetaSignature } from "./metaSignature.js";
import {
  choosePublicReplyTemplate,
  chooseUnusedDmTemplate,
  dateKey,
  findDmAutoResponseRule,
  findModerationRule,
  findPublicReplyRule
} from "./rulesEngine.js";
import { FileStore } from "./store.js";
import type { CommentEvent, DeliveryLog, InstagramAccountConfig, InstagramWebhookPayload, MessageEvent } from "./types.js";
import { extractCommentEvents, extractMessageEvents } from "./webhookParser.js";

const config = loadConfig();
const store = new FileStore(config.dedupeStorePath, config.eventLogPath);
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

function getAccountLogFields(account: InstagramAccountConfig): Pick<DeliveryLog, "accountId" | "accountName" | "igUserId"> {
  return {
    accountId: account.id,
    accountName: account.displayName,
    igUserId: account.metaIgUserId
  };
}

function resolveAccountForComment(event: CommentEvent): InstagramAccountConfig | null {
  if (event.igUserIdFromWebhook && config.accountsByIgUserId[event.igUserIdFromWebhook]) {
    return config.accountsByIgUserId[event.igUserIdFromWebhook];
  }

  return null;
}

function resolveAccountForMessage(event: MessageEvent): InstagramAccountConfig | null {
  if (event.igUserIdFromWebhook && config.accountsByIgUserId[event.igUserIdFromWebhook]) {
    return config.accountsByIgUserId[event.igUserIdFromWebhook];
  }

  if (event.recipientId && config.accountsByIgUserId[event.recipientId]) {
    return config.accountsByIgUserId[event.recipientId];
  }

  return null;
}

function createMetaClient(account: InstagramAccountConfig): MetaClient {
  return new MetaClient(config.metaApiVersion, account);
}

async function processModeration(account: InstagramAccountConfig, event: CommentEvent): Promise<boolean> {
  if (!account.moderationEnabled) return false;

  const rule = findModerationRule(event, account.moderationRules);
  if (!rule) return false;

  const actionKey = `${account.id}:moderation:${rule.action}:${event.commentId}`;
  const claimed = await store.claimAction(actionKey, { mediaId: event.mediaId, keyword: rule.id });
  if (!claimed) {
    await logEvent({
      ...getAccountLogFields(account),
      action: rule.action === "delete" ? "moderation_delete" : "moderation_hide",
      mediaId: event.mediaId,
      commentId: event.commentId,
      ruleId: rule.id,
      succeeded: false,
      status: "duplicate",
      reason: "Moderation action already processed or currently processing"
    });
    return true;
  }

  try {
    const metaClient = createMetaClient(account);
    const result = rule.action === "delete" ? await metaClient.deleteComment(event.commentId) : await metaClient.hideComment(event.commentId);
    if (result.ok) {
      await store.markActionSent(actionKey);
      await logEvent({
        ...getAccountLogFields(account),
        action: rule.action === "delete" ? "moderation_delete" : "moderation_hide",
        mediaId: event.mediaId,
        commentId: event.commentId,
        ruleId: rule.id,
        succeeded: true,
        status: rule.action === "delete" ? "deleted" : "hidden",
        reason: rule.reason,
        metaStatus: result.status,
        metaResponse: result.body
      });
    } else {
      await store.markActionFailed(actionKey, JSON.stringify(result.body));
      await logEvent({
        ...getAccountLogFields(account),
        action: rule.action === "delete" ? "moderation_delete" : "moderation_hide",
        mediaId: event.mediaId,
        commentId: event.commentId,
        ruleId: rule.id,
        succeeded: false,
        status: "failed",
        reason: rule.reason,
        metaStatus: result.status,
        metaResponse: result.body
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await store.markActionFailed(actionKey, message);
    await logEvent({
      ...getAccountLogFields(account),
      action: rule.action === "delete" ? "moderation_delete" : "moderation_hide",
      mediaId: event.mediaId,
      commentId: event.commentId,
      ruleId: rule.id,
      succeeded: false,
      status: "failed",
      reason: message
    });
  }

  return true;
}

async function processPrivateReply(account: InstagramAccountConfig, event: CommentEvent): Promise<void> {
  const match = findKeywordMatch(event.commentText, account.keywordResponses);
  if (!match) return;

  const commentKey = `${account.id}:${event.commentId}`;
  const claimed = await store.claimComment(commentKey, event.mediaId, match.keyword);
  if (!claimed) {
    await logEvent({
      ...getAccountLogFields(account),
      action: "private_reply",
      mediaId: event.mediaId,
      commentId: event.commentId,
      detectedKeyword: match.keyword,
      dmSucceeded: false,
      status: "duplicate",
      reason: "Comment already processed or currently processing"
    });
    return;
  }

  try {
    const metaClient = createMetaClient(account);
    const result = await metaClient.sendPrivateReply(event.commentId, match.responseText);
    if (result.ok) {
      await store.markCommentSent(commentKey);
      await logEvent({
        ...getAccountLogFields(account),
        action: "private_reply",
        mediaId: event.mediaId,
        commentId: event.commentId,
        detectedKeyword: match.keyword,
        dmSucceeded: true,
        status: "sent",
        metaStatus: result.status,
        metaResponse: result.body
      });
    } else {
      await store.markCommentFailed(commentKey, JSON.stringify(result.body));
      await logEvent({
        ...getAccountLogFields(account),
        action: "private_reply",
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
    await store.markCommentFailed(commentKey, message);
    await logEvent({
      ...getAccountLogFields(account),
      action: "private_reply",
      mediaId: event.mediaId,
      commentId: event.commentId,
      detectedKeyword: match.keyword,
      dmSucceeded: false,
      status: "failed",
      reason: message
    });
  }
}

async function processPublicReply(account: InstagramAccountConfig, event: CommentEvent): Promise<void> {
  if (!account.publicRepliesEnabled) return;

  const rule = findPublicReplyRule(event, account.publicReplyRules);
  if (!rule) {
    await logEvent({
      ...getAccountLogFields(account),
      action: "public_reply",
      mediaId: event.mediaId,
      commentId: event.commentId,
      succeeded: false,
      status: "ignored",
      reason: "No public reply rule matched"
    });
    return;
  }

  const today = dateKey();
  const globalCounterKey = `${account.id}:public_reply:${rule.id}:${today}:global`;
  const mediaCounterKey = `${account.id}:public_reply:${rule.id}:${today}:media:${event.mediaId ?? "unknown"}`;

  if (rule.maxRepliesGlobalPerDay !== undefined && (await store.getCounter(globalCounterKey)) >= rule.maxRepliesGlobalPerDay) {
    await logEvent({
      ...getAccountLogFields(account),
      action: "public_reply",
      mediaId: event.mediaId,
      commentId: event.commentId,
      ruleId: rule.id,
      succeeded: false,
      status: "ignored",
      reason: "Public reply global daily cap reached"
    });
    return;
  }

  if (rule.maxRepliesPerMediaPerDay !== undefined && (await store.getCounter(mediaCounterKey)) >= rule.maxRepliesPerMediaPerDay) {
    await logEvent({
      ...getAccountLogFields(account),
      action: "public_reply",
      mediaId: event.mediaId,
      commentId: event.commentId,
      ruleId: rule.id,
      succeeded: false,
      status: "ignored",
      reason: "Public reply media daily cap reached"
    });
    return;
  }

  const actionKey = `${account.id}:public_reply:${event.commentId}`;
  const claimed = await store.claimAction(actionKey, { mediaId: event.mediaId, keyword: rule.id });
  if (!claimed) {
    await logEvent({
      ...getAccountLogFields(account),
      action: "public_reply",
      mediaId: event.mediaId,
      commentId: event.commentId,
      ruleId: rule.id,
      succeeded: false,
      status: "duplicate",
      reason: "Public reply already processed or currently processing"
    });
    return;
  }

  const message = choosePublicReplyTemplate(rule, event.commentId);

  try {
    const metaClient = createMetaClient(account);
    const result = await metaClient.replyToComment(event.commentId, message);
    if (result.ok) {
      await store.markActionSent(actionKey);
      await store.incrementCounter(globalCounterKey);
      await store.incrementCounter(mediaCounterKey);
      await logEvent({
        ...getAccountLogFields(account),
        action: "public_reply",
        mediaId: event.mediaId,
        commentId: event.commentId,
        ruleId: rule.id,
        succeeded: true,
        status: "sent",
        metaStatus: result.status,
        metaResponse: result.body
      });
    } else {
      await store.markActionFailed(actionKey, JSON.stringify(result.body));
      await logEvent({
        ...getAccountLogFields(account),
        action: "public_reply",
        mediaId: event.mediaId,
        commentId: event.commentId,
        ruleId: rule.id,
        succeeded: false,
        status: "failed",
        reason: "Meta comment reply API returned an error",
        metaStatus: result.status,
        metaResponse: result.body
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await store.markActionFailed(actionKey, errorMessage);
    await logEvent({
      ...getAccountLogFields(account),
      action: "public_reply",
      mediaId: event.mediaId,
      commentId: event.commentId,
      ruleId: rule.id,
      succeeded: false,
      status: "failed",
      reason: errorMessage
    });
  }
}

async function processDmAutoResponse(account: InstagramAccountConfig, event: MessageEvent): Promise<void> {
  if (!account.dmAutoResponderEnabled) return;

  const rule = findDmAutoResponseRule(event, account.dmAutoResponseRules);
  if (!rule) {
    await logEvent({
      ...getAccountLogFields(account),
      action: "dm_autoreply",
      messageId: event.messageId,
      senderId: event.senderId,
      succeeded: false,
      status: "ignored",
      reason: "No DM autoresponse rule matched"
    });
    return;
  }

  const today = dateKey();
  const senderStoreKey = `${account.id}:${event.senderId}`;
  const senderCounterKey = `${account.id}:dm_autoreply:${rule.id}:${today}:sender:${event.senderId}`;
  if (rule.maxRepliesPerSenderPerDay !== undefined && (await store.getCounter(senderCounterKey)) >= rule.maxRepliesPerSenderPerDay) {
    await logEvent({
      ...getAccountLogFields(account),
      action: "dm_autoreply",
      messageId: event.messageId,
      senderId: event.senderId,
      ruleId: rule.id,
      succeeded: false,
      status: "ignored",
      reason: "DM sender daily cap reached"
    });
    return;
  }

  const lastSentAt = await store.getSenderRuleLastSentAt(senderStoreKey, rule.id);
  if (lastSentAt && rule.cooldownSeconds !== undefined) {
    const elapsedSeconds = (Date.now() - Date.parse(lastSentAt)) / 1000;
    if (elapsedSeconds < rule.cooldownSeconds) {
      await logEvent({
        ...getAccountLogFields(account),
        action: "dm_autoreply",
        messageId: event.messageId,
        senderId: event.senderId,
        ruleId: rule.id,
        succeeded: false,
        status: "ignored",
        reason: "DM sender cooldown active"
      });
      return;
    }
  }

  const actionKey = `${account.id}:dm_autoreply:${event.messageId}`;
  const claimed = await store.claimAction(actionKey, { keyword: rule.id });
  if (!claimed) {
    await logEvent({
      ...getAccountLogFields(account),
      action: "dm_autoreply",
      messageId: event.messageId,
      senderId: event.senderId,
      ruleId: rule.id,
      succeeded: false,
      status: "duplicate",
      reason: "DM message already processed or currently processing"
    });
    return;
  }

  const usedTemplates = await store.getSenderTemplateHistory(senderStoreKey, rule.id);
  const message = chooseUnusedDmTemplate(rule, event.senderId, usedTemplates);
  if (!message) {
    await store.markActionSent(actionKey);
    await logEvent({
      ...getAccountLogFields(account),
      action: "dm_autoreply",
      messageId: event.messageId,
      senderId: event.senderId,
      ruleId: rule.id,
      succeeded: false,
      status: "ignored",
      reason: "All configured templates for this sender/rule have already been used"
    });
    return;
  }

  try {
    const metaClient = createMetaClient(account);
    const result = await metaClient.sendMessage(event.senderId, message);
    if (result.ok) {
      await store.markActionSent(actionKey);
      await store.incrementCounter(senderCounterKey);
      await store.rememberSenderTemplate(senderStoreKey, rule.id, message);
      await store.rememberSenderRuleSent(senderStoreKey, rule.id);
      await logEvent({
        ...getAccountLogFields(account),
        action: "dm_autoreply",
        messageId: event.messageId,
        senderId: event.senderId,
        ruleId: rule.id,
        succeeded: true,
        status: "sent",
        metaStatus: result.status,
        metaResponse: result.body
      });
    } else {
      await store.markActionFailed(actionKey, JSON.stringify(result.body));
      await logEvent({
        ...getAccountLogFields(account),
        action: "dm_autoreply",
        messageId: event.messageId,
        senderId: event.senderId,
        ruleId: rule.id,
        succeeded: false,
        status: "failed",
        reason: "Meta DM API returned an error",
        metaStatus: result.status,
        metaResponse: result.body
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await store.markActionFailed(actionKey, errorMessage);
    await logEvent({
      ...getAccountLogFields(account),
      action: "dm_autoreply",
      messageId: event.messageId,
      senderId: event.senderId,
      ruleId: rule.id,
      succeeded: false,
      status: "failed",
      reason: errorMessage
    });
  }
}

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
  const messageEvents = extractMessageEvents(payload);

  for (const event of commentEvents) {
    const account = resolveAccountForComment(event);
    if (!account) {
      await logEvent({
        igUserId: event.igUserIdFromWebhook,
        mediaId: event.mediaId,
        commentId: event.commentId,
        status: "ignored",
        reason: "No configured Instagram account matched webhook entry ID"
      });
      continue;
    }

    const moderated = await processModeration(account, event);
    if (moderated) continue;

    await processPrivateReply(account, event);
    await processPublicReply(account, event);
  }

  for (const event of messageEvents) {
    const account = resolveAccountForMessage(event);
    if (!account) {
      await logEvent({
        igUserId: event.igUserIdFromWebhook ?? event.recipientId,
        messageId: event.messageId,
        senderId: event.senderId,
        status: "ignored",
        reason: "No configured Instagram account matched webhook message recipient"
      });
      continue;
    }

    await processDmAutoResponse(account, event);
  }

  res.status(200).json({ received: true, comments: commentEvents.length, messages: messageEvents.length });
});

await store.init();

app.listen(config.port, () => {
  console.log(`Instagram automation bot listening on port ${config.port} for ${config.accounts.length} account(s)`);
});

import type {
  CommentEvent,
  InstagramCommentWebhookValue,
  InstagramWebhookEntry,
  InstagramWebhookPayload,
  MessageEvent
} from "./types.js";

function toCommentEvent(
  entry: InstagramWebhookEntry,
  value: InstagramCommentWebhookValue
): CommentEvent | null {
  if (!value.id || typeof value.text !== "string") {
    return null;
  }

  return {
    igUserIdFromWebhook: entry.id,
    webhookTime: entry.time,
    commentId: value.id,
    commentText: value.text,
    mediaId: value.media?.id,
    mediaProductType: value.media?.media_product_type,
    parentCommentId: value.parent_id,
    commenterId: value.from?.id,
    commenterUsername: value.from?.username
  };
}

export function extractCommentEvents(payload: InstagramWebhookPayload): CommentEvent[] {
  const events: CommentEvent[] = [];

  for (const entry of payload.entry ?? []) {
    if (entry.field === "comments" && entry.value) {
      const event = toCommentEvent(entry, entry.value);
      if (event) events.push(event);
    }

    for (const change of entry.changes ?? []) {
      if (change.field !== "comments" || !change.value) continue;

      const event = toCommentEvent(entry, change.value);
      if (event) events.push(event);
    }
  }

  return events;
}

export function extractMessageEvents(payload: InstagramWebhookPayload): MessageEvent[] {
  const events: MessageEvent[] = [];

  for (const entry of payload.entry ?? []) {
    for (const item of entry.messaging ?? []) {
      const senderId = item.sender?.id;
      const messageId = item.message?.mid ?? item.postback?.mid;
      const messageText = item.message?.text ?? item.postback?.payload ?? item.postback?.title;

      if (!senderId || !messageId || typeof messageText !== "string") continue;
      if (item.message?.is_echo || item.message?.is_deleted || item.message?.is_unsupported) continue;

      events.push({
        igUserIdFromWebhook: entry.id,
        senderId,
        recipientId: item.recipient?.id,
        messageId,
        messageText,
        timestamp: item.timestamp
      });
    }
  }

  return events;
}

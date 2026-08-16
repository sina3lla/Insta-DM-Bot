import type {
  CommentEvent,
  InstagramCommentWebhookValue,
  InstagramWebhookEntry,
  InstagramWebhookPayload
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

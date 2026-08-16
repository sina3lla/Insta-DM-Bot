export type KeywordResponses = Record<string, string>;

export type AppConfig = {
  port: number;
  nodeEnv: string;
  metaAppSecret: string;
  metaVerifyToken: string;
  metaAccessToken: string;
  metaIgUserId: string;
  metaApiVersion: string;
  verifyMetaSignatures: boolean;
  keywordResponses: KeywordResponses;
  dedupeStorePath: string;
  eventLogPath: string;
};

export type InstagramWebhookPayload = {
  object?: string;
  entry?: InstagramWebhookEntry[];
};

export type InstagramWebhookEntry = {
  id?: string;
  time?: number;
  field?: string;
  value?: InstagramCommentWebhookValue;
  changes?: Array<{
    field?: string;
    value?: InstagramCommentWebhookValue;
  }>;
};

export type InstagramCommentWebhookValue = {
  id?: string;
  text?: string;
  parent_id?: string;
  media?: {
    id?: string;
    media_product_type?: string;
  };
  from?: {
    id?: string;
    username?: string;
  };
};

export type CommentEvent = {
  igUserIdFromWebhook?: string;
  webhookTime?: number;
  commentId: string;
  commentText: string;
  mediaId?: string;
  mediaProductType?: string;
  parentCommentId?: string;
  commenterId?: string;
  commenterUsername?: string;
};

export type KeywordMatch = {
  keyword: string;
  responseText: string;
};

export type DeliveryLog = {
  timestamp: string;
  mediaId?: string;
  commentId?: string;
  detectedKeyword?: string;
  dmSucceeded: boolean;
  status: "sent" | "ignored" | "duplicate" | "failed";
  reason?: string;
  metaStatus?: number;
  metaResponse?: unknown;
};

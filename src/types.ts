export type KeywordResponses = Record<string, string>;

export type PublicReplyRule = {
  id: string;
  enabled: boolean;
  templates: string[];
  anyKeywords?: string[];
  excludeKeywords?: string[];
  requiredAnyKeywords?: string[];
  philosophyKeywords?: string[];
  minLength?: number;
  maxLength?: number;
  requireQuestion?: boolean;
  requirePositiveSignal?: boolean;
  minScore?: number;
  probability?: number;
  maxRepliesPerMediaPerDay?: number;
  maxRepliesGlobalPerDay?: number;
};

export type ModerationAction = "delete" | "hide" | "none";

export type ModerationRule = {
  id: string;
  enabled: boolean;
  action: ModerationAction;
  keywords: string[];
  reason: string;
};

export type DmAutoResponseRule = {
  id: string;
  enabled: boolean;
  templates: string[];
  anyKeywords?: string[];
  excludeKeywords?: string[];
  requiredAnyKeywords?: string[];
  maxRepliesPerSenderPerDay?: number;
  cooldownSeconds?: number;
};

export type InstagramAccountConfig = {
  id: string;
  displayName: string;
  metaIgUserId: string;
  metaAccessToken: string;
  keywordResponses: KeywordResponses;
  publicReplyRules: PublicReplyRule[];
  moderationRules: ModerationRule[];
  dmAutoResponseRules: DmAutoResponseRule[];
  publicRepliesEnabled: boolean;
  moderationEnabled: boolean;
  dmAutoResponderEnabled: boolean;
};

export type AppConfig = {
  port: number;
  nodeEnv: string;
  metaAppSecret: string;
  metaVerifyToken: string;
  metaApiVersion: string;
  verifyMetaSignatures: boolean;
  accounts: InstagramAccountConfig[];
  accountsByIgUserId: Record<string, InstagramAccountConfig>;
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
  messaging?: InstagramMessagingWebhookValue[];
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

export type InstagramMessagingWebhookValue = {
  sender?: {
    id?: string;
  };
  recipient?: {
    id?: string;
  };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    is_deleted?: boolean;
    is_unsupported?: boolean;
  };
  postback?: {
    mid?: string;
    title?: string;
    payload?: string;
  };
};

export type MessageEvent = {
  igUserIdFromWebhook?: string;
  senderId: string;
  recipientId?: string;
  messageId: string;
  messageText: string;
  timestamp?: number;
};

export type KeywordMatch = {
  keyword: string;
  responseText: string;
};

export type DeliveryLog = {
  timestamp: string;
  accountId?: string;
  accountName?: string;
  igUserId?: string;
  mediaId?: string;
  commentId?: string;
  messageId?: string;
  senderId?: string;
  detectedKeyword?: string;
  ruleId?: string;
  action?: "private_reply" | "public_reply" | "moderation_delete" | "moderation_hide" | "dm_autoreply";
  dmSucceeded?: boolean;
  succeeded?: boolean;
  status: "sent" | "ignored" | "duplicate" | "failed" | "deleted" | "hidden";
  reason?: string;
  metaStatus?: number;
  metaResponse?: unknown;
};

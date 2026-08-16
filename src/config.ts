import "dotenv/config";
import type {
  AppConfig,
  DmAutoResponseRule,
  KeywordResponses,
  ModerationRule,
  PublicReplyRule
} from "./types.js";

function readRequired(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function readKeywordResponses(): KeywordResponses {
  const raw = readRequired("KEYWORD_RESPONSES_JSON");
  const parsed = JSON.parse(raw) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("KEYWORD_RESPONSES_JSON must be a JSON object");
  }

  const responses: KeywordResponses = {};
  for (const [keyword, response] of Object.entries(parsed)) {
    if (typeof response !== "string" || response.trim() === "") {
      throw new Error(`Keyword "${keyword}" must map to a non-empty string response`);
    }

    const normalizedKeyword = keyword.trim().toUpperCase();
    if (!normalizedKeyword) {
      throw new Error("Keyword names cannot be empty");
    }

    responses[normalizedKeyword] = response;
  }

  if (Object.keys(responses).length === 0) {
    throw new Error("KEYWORD_RESPONSES_JSON must contain at least one keyword");
  }

  return responses;
}

function readJsonArray<T>(name: string, fallback: T[]): T[] {
  const raw = process.env[name];
  if (!raw || raw.trim() === "") return fallback;

  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON array`);
  }

  return parsed as T[];
}

export function loadConfig(): AppConfig {
  return {
    port: Number(process.env.PORT ?? 3000),
    nodeEnv: process.env.NODE_ENV ?? "development",
    metaAppSecret: readRequired("META_APP_SECRET"),
    metaVerifyToken: readRequired("META_VERIFY_TOKEN"),
    metaAccessToken: readRequired("META_ACCESS_TOKEN"),
    metaIgUserId: readRequired("META_IG_USER_ID"),
    metaApiVersion: process.env.META_API_VERSION ?? "v25.0",
    verifyMetaSignatures: readBoolean("VERIFY_META_SIGNATURES", true),
    keywordResponses: readKeywordResponses(),
    publicReplyRules: readJsonArray<PublicReplyRule>("PUBLIC_REPLY_RULES_JSON", []),
    moderationRules: readJsonArray<ModerationRule>("MODERATION_RULES_JSON", []),
    dmAutoResponseRules: readJsonArray<DmAutoResponseRule>("DM_AUTORESPONSES_JSON", []),
    publicRepliesEnabled: readBoolean("PUBLIC_REPLIES_ENABLED", false),
    moderationEnabled: readBoolean("MODERATION_ENABLED", true),
    dmAutoResponderEnabled: readBoolean("DM_AUTORESPONDER_ENABLED", false),
    dedupeStorePath: process.env.DEDUPE_STORE_PATH ?? "data/processed-comments.json",
    eventLogPath: process.env.EVENT_LOG_PATH ?? "data/events.jsonl"
  };
}

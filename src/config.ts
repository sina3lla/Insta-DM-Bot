import "dotenv/config";
import type {
  AppConfig,
  DmAutoResponseRule,
  InstagramAccountConfig,
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

function parseKeywordResponses(parsed: unknown, sourceName: string): KeywordResponses {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${sourceName} must be a JSON object`);
  }

  const responses: KeywordResponses = {};
  for (const [keyword, response] of Object.entries(parsed)) {
    if (typeof response !== "string" || response.trim() === "") {
      throw new Error(`${sourceName}: keyword "${keyword}" must map to a non-empty string response`);
    }

    const normalizedKeyword = keyword.trim().toUpperCase();
    if (!normalizedKeyword) {
      throw new Error("Keyword names cannot be empty");
    }

    responses[normalizedKeyword] = response;
  }

  if (Object.keys(responses).length === 0) {
    throw new Error(`${sourceName} must contain at least one keyword`);
  }

  return responses;
}

function readKeywordResponses(): KeywordResponses {
  return parseKeywordResponses(JSON.parse(readRequired("KEYWORD_RESPONSES_JSON")) as unknown, "KEYWORD_RESPONSES_JSON");
}

function parseJsonArray<T>(parsed: unknown, sourceName: string): T[] {
  if (!Array.isArray(parsed)) {
    throw new Error(`${sourceName} must be a JSON array`);
  }

  return parsed as T[];
}

function readJsonArray<T>(name: string, fallback: T[]): T[] {
  const raw = process.env[name];
  if (!raw || raw.trim() === "") return fallback;
  return parseJsonArray<T>(JSON.parse(raw) as unknown, name);
}

function readLegacySingleAccount(): InstagramAccountConfig | null {
  if (!process.env.META_ACCESS_TOKEN || !process.env.META_IG_USER_ID || !process.env.KEYWORD_RESPONSES_JSON) {
    return null;
  }

  return {
    id: "default",
    displayName: "Default Instagram account",
    metaIgUserId: readRequired("META_IG_USER_ID"),
    metaAccessToken: readRequired("META_ACCESS_TOKEN"),
    keywordResponses: readKeywordResponses(),
    publicReplyRules: readJsonArray<PublicReplyRule>("PUBLIC_REPLY_RULES_JSON", []),
    moderationRules: readJsonArray<ModerationRule>("MODERATION_RULES_JSON", []),
    dmAutoResponseRules: readJsonArray<DmAutoResponseRule>("DM_AUTORESPONSES_JSON", []),
    publicRepliesEnabled: readBoolean("PUBLIC_REPLIES_ENABLED", false),
    moderationEnabled: readBoolean("MODERATION_ENABLED", true),
    dmAutoResponderEnabled: readBoolean("DM_AUTORESPONDER_ENABLED", false)
  };
}

function readAccounts(): InstagramAccountConfig[] {
  const raw = process.env.INSTAGRAM_ACCOUNTS_JSON;
  if (!raw || raw.trim() === "") {
    const legacyAccount = readLegacySingleAccount();
    if (legacyAccount) return [legacyAccount];
    throw new Error("Missing required environment variable: INSTAGRAM_ACCOUNTS_JSON");
  }

  const parsed = JSON.parse(raw) as unknown;
  const accounts = parseJsonArray<Partial<InstagramAccountConfig>>(parsed, "INSTAGRAM_ACCOUNTS_JSON");

  return accounts.map((account, index) => {
    const source = `INSTAGRAM_ACCOUNTS_JSON[${index}]`;
    if (!account.id || !account.displayName || !account.metaIgUserId || !account.metaAccessToken) {
      throw new Error(`${source} must include id, displayName, metaIgUserId, and metaAccessToken`);
    }

    return {
      id: account.id,
      displayName: account.displayName,
      metaIgUserId: account.metaIgUserId,
      metaAccessToken: account.metaAccessToken,
      keywordResponses: parseKeywordResponses(account.keywordResponses, `${source}.keywordResponses`),
      publicReplyRules: Array.isArray(account.publicReplyRules) ? account.publicReplyRules : [],
      moderationRules: Array.isArray(account.moderationRules) ? account.moderationRules : [],
      dmAutoResponseRules: Array.isArray(account.dmAutoResponseRules) ? account.dmAutoResponseRules : [],
      publicRepliesEnabled: account.publicRepliesEnabled ?? false,
      moderationEnabled: account.moderationEnabled ?? true,
      dmAutoResponderEnabled: account.dmAutoResponderEnabled ?? false
    };
  });
}

export function loadConfig(): AppConfig {
  const accounts = readAccounts();
  const accountsByIgUserId: Record<string, InstagramAccountConfig> = {};

  for (const account of accounts) {
    if (accountsByIgUserId[account.metaIgUserId]) {
      throw new Error(`Duplicate metaIgUserId in account config: ${account.metaIgUserId}`);
    }
    accountsByIgUserId[account.metaIgUserId] = account;
  }

  return {
    port: Number(process.env.PORT ?? 3000),
    nodeEnv: process.env.NODE_ENV ?? "development",
    metaAppSecret: readRequired("META_APP_SECRET"),
    metaVerifyToken: readRequired("META_VERIFY_TOKEN"),
    metaApiVersion: process.env.META_API_VERSION ?? "v25.0",
    verifyMetaSignatures: readBoolean("VERIFY_META_SIGNATURES", true),
    accounts,
    accountsByIgUserId,
    dedupeStorePath: process.env.DEDUPE_STORE_PATH ?? "data/processed-comments.json",
    eventLogPath: process.env.EVENT_LOG_PATH ?? "data/events.jsonl"
  };
}

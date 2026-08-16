import type {
  CommentEvent,
  DmAutoResponseRule,
  MessageEvent,
  ModerationRule,
  PublicReplyRule
} from "./types.js";

const DEFAULT_POSITIVE_SIGNALS = [
  "love",
  "great",
  "amazing",
  "helpful",
  "needed",
  "thanks",
  "thank you",
  "interesting",
  "smart",
  "true",
  "agree",
  "inspiring",
  "valuable"
];

const DEFAULT_NEGATIVE_SIGNALS = [
  "scam",
  "fake",
  "trash",
  "hate",
  "stupid",
  "idiot",
  "worst",
  "unfollow",
  "reported"
];

function normalize(value: string): string {
  return value.toLowerCase();
}

function includesAny(text: string, keywords: string[] | undefined): boolean {
  if (!Array.isArray(keywords) || keywords.length === 0) return false;
  const normalizedText = normalize(text);
  return keywords.some((keyword) => normalizedText.includes(normalize(keyword)));
}

function includesAll(text: string, keywords: string[] | undefined): boolean {
  if (!Array.isArray(keywords) || keywords.length === 0) return true;
  const normalizedText = normalize(text);
  return keywords.every((keyword) => normalizedText.includes(normalize(keyword)));
}

function stableRatio(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 4294967295;
}

function chooseBySeed(values: string[], seed: string): string {
  const index = Math.floor(stableRatio(seed) * values.length);
  return values[Math.min(index, values.length - 1)];
}

function scoreComment(text: string, rule: PublicReplyRule): number {
  let score = 0;
  const normalizedText = normalize(text);

  if (text.includes("?")) score += 2;
  if (includesAny(normalizedText, DEFAULT_POSITIVE_SIGNALS)) score += 2;
  if (includesAny(normalizedText, rule.philosophyKeywords)) score += 2;
  if (text.length >= 40) score += 1;
  if (includesAny(normalizedText, DEFAULT_NEGATIVE_SIGNALS)) score -= 4;
  if (includesAny(normalizedText, rule.excludeKeywords)) score -= 10;

  return score;
}

export function findModerationRule(comment: CommentEvent, rules: ModerationRule[]): ModerationRule | null {
  for (const rule of rules) {
    if (!rule.enabled || rule.action === "none" || !Array.isArray(rule.keywords)) continue;
    if (includesAny(comment.commentText, rule.keywords)) return rule;
  }

  return null;
}

export function findPublicReplyRule(comment: CommentEvent, rules: PublicReplyRule[]): PublicReplyRule | null {
  for (const rule of rules) {
    if (!rule.enabled || !Array.isArray(rule.templates) || rule.templates.length === 0) continue;
    if (rule.minLength !== undefined && comment.commentText.length < rule.minLength) continue;
    if (rule.maxLength !== undefined && comment.commentText.length > rule.maxLength) continue;
    if (rule.requireQuestion && !comment.commentText.includes("?")) continue;
    if (includesAny(comment.commentText, rule.excludeKeywords)) continue;
    if (rule.anyKeywords && !includesAny(comment.commentText, rule.anyKeywords)) continue;
    if (!includesAll(comment.commentText, rule.requiredAnyKeywords)) continue;
    if (Array.isArray(rule.philosophyKeywords) && rule.philosophyKeywords.length > 0 && !includesAny(comment.commentText, rule.philosophyKeywords)) {
      continue;
    }

    const score = scoreComment(comment.commentText, rule);
    if (rule.requirePositiveSignal && score < 2) continue;
    if (rule.minScore !== undefined && score < rule.minScore) continue;
    if (rule.probability !== undefined && stableRatio(`${comment.commentId}:${rule.id}`) > rule.probability) continue;

    return rule;
  }

  return null;
}

export function findDmAutoResponseRule(message: MessageEvent, rules: DmAutoResponseRule[]): DmAutoResponseRule | null {
  for (const rule of rules) {
    if (!rule.enabled || !Array.isArray(rule.templates) || rule.templates.length === 0) continue;
    if (includesAny(message.messageText, rule.excludeKeywords)) continue;
    if (rule.anyKeywords && !includesAny(message.messageText, rule.anyKeywords)) continue;
    if (!includesAll(message.messageText, rule.requiredAnyKeywords)) continue;
    return rule;
  }

  return null;
}

export function choosePublicReplyTemplate(rule: PublicReplyRule, commentId: string): string {
  return chooseBySeed(rule.templates, `${commentId}:${rule.id}`);
}

export function chooseUnusedDmTemplate(rule: DmAutoResponseRule, senderId: string, usedTemplates: string[]): string | null {
  const available = rule.templates.filter((template) => !usedTemplates.includes(template));
  if (available.length === 0) return null;
  return chooseBySeed(available, `${senderId}:${rule.id}:${usedTemplates.length}`);
}

export function dateKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

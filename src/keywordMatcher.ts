import type { KeywordMatch, KeywordResponses } from "./types.js";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findKeywordMatch(commentText: string, responses: KeywordResponses): KeywordMatch | null {
  const normalizedComment = commentText.toUpperCase();
  const keywords = Object.keys(responses).sort((a, b) => b.length - a.length);

  for (const keyword of keywords) {
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(keyword)}($|[^\\p{L}\\p{N}_])`, "u");
    if (pattern.test(normalizedComment)) {
      return {
        keyword,
        responseText: responses[keyword]
      };
    }
  }

  return null;
}

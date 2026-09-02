# Insta DM Bot PHP

Minimal Instagram automation using Meta's official Instagram Platform API, rewritten as plain PHP for shared hosting such as Hetzner Webhosting M.

Flow:

```text
Instagram comment/DM -> Meta webhook -> public/index.php -> account rules -> Meta API action
```

No Node.js, TypeScript, Composer, database, queue, or background worker is required.

## What It Does

- Receives Instagram webhook events at `/instagram-bot/webhook`.
- Handles multiple Instagram Professional accounts from one Meta app.
- Routes events by the Instagram account ID in the webhook payload.
- Sends private DM replies when comments contain configured keywords.
- Optionally replies publicly to selected comments with configurable rules and caps.
- Optionally hides or deletes harmful/spam/business-risk comments.
- Optionally sends incoming DM autoresponses with non-repeating templates per sender/rule.
- Dedupes Meta webhook retries with a locked JSON file.
- Logs actions as JSON lines.
- Verifies `X-Hub-Signature-256` with your Meta app secret.
- Retries Meta rate-limit and transient errors.

## Requirements

- PHP 8.1+ recommended.
- PHP cURL extension enabled.
- Apache with `.htaccess` rewrite support.
- Public HTTPS path: `https://selinabernard.com/instagram-bot/`.
- One Meta Developer app.
- One or more Instagram Business/Creator accounts.

This version is designed for Hetzner Webhosting M because it does not need a permanently running Node.js process.

## Project Structure

```text
app/
  bootstrap.php        Loads all PHP modules
  config.php           Environment and account config
  handlers.php         Webhook processing logic
  logger.php           JSONL event logging
  meta_client.php      Meta API calls and retry handling
  rules.php            Keyword, moderation, public reply, and DM rules
  store.php            File-backed dedupe/counters/template memory
  webhook_parser.php   Instagram webhook extraction
public/
  .htaccess            Routes /instagram-bot/webhook and /instagram-bot/health to index.php
  index.php            Public entrypoint
data/
  processed-comments.json
  events.jsonl
```

This repo is configured for the practical Hetzner shared-hosting layout where the whole bot folder sits under `public_html/instagram-bot/`. The root `.htaccess` routes public traffic into `public/index.php` and blocks `app/`, `data/`, `.env`, `.env.example`, Git files, and the README from direct browser access.

## Configuration

Copy the example:

```bash
cp .env.example .env
```

Edit `.env`:

```env
META_APP_SECRET=your_meta_app_secret
META_VERIFY_TOKEN=make_a_long_random_string
META_API_VERSION=v25.0
APP_BASE_PATH=/instagram-bot
VERIFY_META_SIGNATURES=true
INSTAGRAM_ACCOUNTS_JSON=[{"id":"brand-a","displayName":"Brand A","metaIgUserId":"17841400000000000","metaAccessToken":"token_for_brand_a","keywordResponses":{"GUIDE":"Hey! Here's the guide: https://example.com/a-guide"},"publicRepliesEnabled":false,"publicReplyRules":[],"moderationEnabled":true,"moderationRules":[],"dmAutoResponderEnabled":false,"dmAutoResponseRules":[]},{"id":"brand-b","displayName":"Brand B","metaIgUserId":"17841411111111111","metaAccessToken":"token_for_brand_b","keywordResponses":{"GUIDE":"Hey! Here's the guide: https://example.com/b-guide"},"publicRepliesEnabled":false,"publicReplyRules":[],"moderationEnabled":true,"moderationRules":[],"dmAutoResponderEnabled":false,"dmAutoResponseRules":[]}]
DEDUPE_STORE_PATH=data/processed-comments.json
EVENT_LOG_PATH=data/events.jsonl
```

`META_APP_SECRET`, `META_VERIFY_TOKEN`, and `META_API_VERSION` belong to the Meta app. Each Instagram account gets its own `metaIgUserId`, `metaAccessToken`, and rules inside `INSTAGRAM_ACCOUNTS_JSON`.

## Hetzner Webhosting M Deployment

Target URLs:

```text
https://selinabernard.com/instagram-bot/health
https://selinabernard.com/instagram-bot/webhook
```

Recommended upload layout:

```text
/home/.../public_html/instagram-bot/.htaccess
/home/.../public_html/instagram-bot/.env
/home/.../public_html/instagram-bot/app/
/home/.../public_html/instagram-bot/data/
/home/.../public_html/instagram-bot/public/
```

The public URLs still stay clean because the root `.htaccess` silently routes requests into `public/index.php`.

The included access rules block these direct browser paths:

```text
https://selinabernard.com/instagram-bot/.env
https://selinabernard.com/instagram-bot/.env.example
https://selinabernard.com/instagram-bot/app/
https://selinabernard.com/instagram-bot/data/
https://selinabernard.com/instagram-bot/.git/
https://selinabernard.com/instagram-bot/README.md
```

Make sure `data/` is writable by PHP. The bot creates/updates:

```text
data/processed-comments.json
data/events.jsonl
```

Do not commit real secrets. Keep `.env` private and use the included access rules if it has to sit inside `/instagram-bot/`.

After upload, test:

```text
https://selinabernard.com/instagram-bot/health should return JSON
https://selinabernard.com/instagram-bot/.env should return 403 or be blocked
https://selinabernard.com/instagram-bot/app/config.php should return 403 or be blocked
https://selinabernard.com/instagram-bot/data/ should return 403 or be blocked
```

## Meta Webhook Settings

In Meta Developers, configure the Instagram webhook:

```text
Callback URL: https://selinabernard.com/instagram-bot/webhook
Verify token: exactly the same value as META_VERIFY_TOKEN
```

Subscribe to:

- `comments` for comment keyword DMs, public replies, and moderation.
- `messages` for incoming DM autoresponse.
- `messaging_postbacks` only if you later add button/postback logic.

Leave client certificate off.

## Local Testing

Run PHP locally:

```bash
php -S localhost:3000 -t public public/index.php
```

Health check:

```bash
curl http://localhost:3000/instagram-bot/health
```

Webhook challenge:

```bash
curl "http://localhost:3000/instagram-bot/webhook?hub.mode=subscribe&hub.verify_token=replace_with_any_random_verify_token&hub.challenge=CHALLENGE_ACCEPTED"
```

For unsigned local testing, set:

```env
VERIFY_META_SIGNATURES=false
```

Then send a sample comment:

```bash
curl -X POST "http://localhost:3000/instagram-bot/webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "object": "instagram",
    "entry": [
      {
        "id": "replace_with_one_configured_metaIgUserId",
        "time": 1760000000000,
        "field": "comments",
        "value": {
          "id": "17900000000000000",
          "from": { "username": "sample_user" },
          "text": "GUIDE please",
          "media": {
            "id": "18000000000000000",
            "media_product_type": "REELS"
          }
        }
      }
    ]
  }'
```

## Rule Examples

Keyword DM replies:

```json
"keywordResponses": {
  "GUIDE": "Hey! Here's the guide: https://example.com/guide",
  "BOT": "Here's the chatbot: https://example.com/bot"
}
```

Public comment replies:

```json
"publicRepliesEnabled": true,
"publicReplyRules": [
  {
    "id": "high-intent-brand-fit",
    "enabled": true,
    "templates": [
      "Appreciate this. That is exactly the kind of question worth asking.",
      "Strong point. This is the part most people skip."
    ],
    "philosophyKeywords": ["clarity", "discipline", "systems", "growth"],
    "excludeKeywords": ["cheap", "scam", "fake", "dm me"],
    "minLength": 25,
    "maxLength": 280,
    "requirePositiveSignal": true,
    "minScore": 3,
    "probability": 0.35,
    "maxRepliesPerMediaPerDay": 8,
    "maxRepliesGlobalPerDay": 35
  }
]
```

Moderation:

```json
"moderationEnabled": true,
"moderationRules": [
  {
    "id": "hate-harassment-threats",
    "enabled": true,
    "action": "delete",
    "reason": "Hateful, harassing, or threatening language",
    "keywords": ["kill yourself", "kys", "go die"]
  },
  {
    "id": "business-risk-spam",
    "enabled": true,
    "action": "hide",
    "reason": "Spam or bad-for-business solicitation",
    "keywords": ["buy followers", "crypto giveaway", "dm for promo"]
  }
]
```

Incoming DM autoresponder:

```json
"dmAutoResponderEnabled": true,
"dmAutoResponseRules": [
  {
    "id": "pricing",
    "enabled": true,
    "anyKeywords": ["price", "pricing", "cost", "how much"],
    "excludeKeywords": ["refund", "angry", "scam"],
    "maxRepliesPerSenderPerDay": 2,
    "cooldownSeconds": 3600,
    "templates": [
      "I can help with that. The best starting point is here: https://example.com/pricing",
      "Good question. Pricing depends on the setup, but this page gives the clean overview: https://example.com/pricing"
    ]
  }
]
```

## Current Meta API Calls

- Private reply DM: `POST https://graph.instagram.com/{version}/{ig-user-id}/messages`
- Public comment reply: `POST https://graph.instagram.com/{version}/{comment-id}/replies`
- Hide comment: `POST https://graph.instagram.com/{version}/{comment-id}?hide=true`
- Delete comment: `DELETE https://graph.instagram.com/{version}/{comment-id}`
- Incoming DM reply: `POST https://graph.instagram.com/{version}/{ig-user-id}/messages`

Keep `META_API_VERSION` pinned and update it deliberately after checking your Meta app dashboard and Meta's changelog.

## Limitations

- This is deterministic rule automation, not AI.
- File-backed dedupe is intended for one hosting instance.
- Long-lived Instagram tokens still expire and must be refreshed before expiry.
- Meta messaging windows and private reply rules still apply.
- Public reply and moderation filters are conservative text rules; review logs before turning caps up.

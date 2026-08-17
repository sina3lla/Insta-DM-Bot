# Insta DM Bot

Minimal Instagram comment-to-DM automation using Meta's official Instagram Platform API.

Flow:

```text
Instagram comment/DM -> one Meta app webhook -> Express /webhook -> route by IG account ID -> that account's rules -> Meta action
```

No AI is included in v1. The matcher is deterministic and isolated in `src/keywordMatcher.ts` so it can later be replaced with an agent.

## What It Does

- Receives Instagram `comments` webhook events.
- Receives webhook events for multiple Instagram Professional accounts from one Meta Developer app.
- Routes each event by the Instagram account ID in the webhook payload.
- Matches configured keywords case-insensitively.
- Sends one private reply DM through Meta's Instagram Messaging private reply API.
- Optionally sends public replies to high-fit comments using configurable quality, philosophy, probability, and daily cap rules.
- Optionally hides or deletes harmful, hateful, spammy, or business-risk comments before any engagement automation runs.
- Optionally receives incoming Instagram DM webhooks and sends randomized, non-repeating template replies by trigger.
- Dedupes by Instagram comment ID so Meta webhook retries do not send duplicate DMs.
- Logs timestamp, media ID, comment ID, keyword, delivery status, and Meta response.
- Verifies `X-Hub-Signature-256` with your Meta app secret.
- Retries Meta API rate-limit and transient errors with exponential backoff.

## Current Meta API Choices

This implementation uses the current Instagram Platform API model documented by Meta for Instagram professional accounts:

- Private replies endpoint: `POST https://graph.instagram.com/{api-version}/{ig-user-id}/messages`
- Public comment reply endpoint: `POST https://graph.instagram.com/{api-version}/{ig-comment-id}/replies`
- Comment moderation endpoints:
  - Hide: `POST https://graph.instagram.com/{api-version}/{ig-comment-id}?hide=true`
  - Delete: `DELETE https://graph.instagram.com/{api-version}/{ig-comment-id}`
- Incoming DM reply endpoint: `POST https://graph.instagram.com/{api-version}/{ig-user-id}/messages` with `recipient.id`
- Private reply request body:

```json
{
  "recipient": {
    "comment_id": "<COMMENT_ID>"
  },
  "message": {
    "text": "Hey! Here's the guide: https://example.com"
  }
}
```

- Webhook object: `instagram`
- Webhook fields used by this app:
  - `comments` for comment automation and moderation
  - `messages` for incoming DM autoresponse
  - `messaging_postbacks` if you later use icebreakers/buttons
- Signature header: `X-Hub-Signature-256`

The default `META_API_VERSION` is `v25.0`, which Meta's 2026 Instagram Platform/Postman documentation and Graph API release material list for 2026 examples. Keep this pinned and update it deliberately after checking your Meta app dashboard and the Meta Graph API changelog.

Meta docs to verify against before production:

- Instagram Platform overview: https://developers.facebook.com/docs/instagram-platform
- Instagram API with Instagram Login: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login
- Private replies: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/private-replies
- Webhooks: https://developers.facebook.com/docs/graph-api/webhooks
- Instagram webhook reference: https://developers.facebook.com/docs/graph-api/webhooks/reference/instagram
- Meta's Instagram Postman collection: https://www.postman.com/meta/instagram

## Requirements

- Node.js 20+
- One or more Instagram Professional accounts: Business or Creator
- One Meta Developer app
- Public HTTPS URL for the webhook

## Setup

Install dependencies:

```bash
npm install
```

Create your environment:

```bash
cp .env.example .env
```

Edit `.env`:

```bash
META_APP_SECRET=your_meta_app_secret
META_VERIFY_TOKEN=make_a_long_random_string
META_API_VERSION=v25.0
VERIFY_META_SIGNATURES=true
INSTAGRAM_ACCOUNTS_JSON=[{"id":"brand-a","displayName":"Brand A","metaIgUserId":"17841400000000000","metaAccessToken":"token_for_brand_a","keywordResponses":{"GUIDE":"Hey! Here's the guide: https://example.com/a-guide"},"publicRepliesEnabled":false,"publicReplyRules":[],"moderationEnabled":true,"moderationRules":[],"dmAutoResponderEnabled":false,"dmAutoResponseRules":[]},{"id":"brand-b","displayName":"Brand B","metaIgUserId":"17841411111111111","metaAccessToken":"token_for_brand_b","keywordResponses":{"GUIDE":"Hey! Here's the guide: https://example.com/b-guide"},"publicRepliesEnabled":false,"publicReplyRules":[],"moderationEnabled":true,"moderationRules":[],"dmAutoResponderEnabled":false,"dmAutoResponseRules":[]}]
```

`META_APP_SECRET`, `META_VERIFY_TOKEN`, and `META_API_VERSION` are global because they belong to the one Meta app. `metaIgUserId`, `metaAccessToken`, and all automation rules live inside each account object.

For local development, the app still supports the old single-account env variables as a fallback. For production with two accounts, use `INSTAGRAM_ACCOUNTS_JSON`.

## Multi-Account Routing

The app expects one Meta app and one webhook URL:

```text
https://your-domain.com/webhook
```

Meta includes the Instagram Professional account ID on webhook entries. The app looks that ID up in `INSTAGRAM_ACCOUNTS_JSON`:

```text
entry.id -> accountsByIgUserId[entry.id] -> Brand A or Brand B rules/token
```

That means each IG account can have separate:

- access token
- keyword DM replies
- public reply rules
- moderation rules
- DM autoresponder rules
- daily caps
- logs and dedupe keys

## Automation Controls

### 1. Private DM after keyword comment

Configured by each account's `keywordResponses`.

Example:

```json
{
  "GUIDE": "Hey! Here's the guide: https://example.com/guide",
  "BOT": "Here's the chatbot: https://example.com/bot"
}
```

This sends a private reply DM tied to the comment. It does not create an open-ended conversation unless the user replies and Meta's messaging window allows a response.

### 2. Public comment replies

Turn on inside the relevant account:

```json
"publicRepliesEnabled": true
```

Configured by that account's `publicReplyRules`.

Each rule can control:

- `philosophyKeywords`: topics aligned with your worldview or brand.
- `excludeKeywords`: terms that should block a public reply.
- `minLength` / `maxLength`: avoid replying to low-effort or huge comments.
- `requirePositiveSignal`: prefer comments that appear constructive.
- `minScore`: raise this to be more selective.
- `probability`: reply to only a fraction of matching comments.
- `maxRepliesPerMediaPerDay`: avoid spamming one post.
- `maxRepliesGlobalPerDay`: global safety cap.
- `templates`: randomized public replies.

Example:

```json
[
  {
    "id": "high-intent-brand-fit",
    "enabled": true,
    "templates": [
      "Appreciate this. That is exactly the kind of question worth asking.",
      "Yes - this is the direction I think more people should be looking at.",
      "Strong point. This is the part most people skip."
    ],
    "philosophyKeywords": ["clarity", "discipline", "systems", "growth", "business", "automation"],
    "excludeKeywords": ["cheap", "scam", "fake", "dm me", "promo"],
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

The first version is deterministic and conservative. It is not AI. It does not truly know your philosophy yet; it approximates it through explicit rules that can be tuned after you see logs.

### 3. Comment moderation

Turn on inside the relevant account:

```json
"moderationEnabled": true
```

Configured by that account's `moderationRules`.

Each rule can `delete`, `hide`, or do nothing. Moderation runs before any private DM or public reply. That means harmful comments are removed or hidden and never receive engagement.

Use `delete` only for high-confidence categories such as threats, hateful slurs, and harassment. Use `hide` for business-risk content such as spam, scams, solicitation, or low-confidence brand safety terms.

Example:

```json
[
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
    "keywords": ["buy followers", "crypto giveaway", "dm for promo", "telegram me"]
  }
]
```

Meta-supported comment moderation actions available here:

- Reply publicly to a comment.
- Hide or unhide a comment.
- Delete a comment.
- Read comments and replies.

### 4. Incoming DM autoresponder

Turn on inside the relevant account:

```json
"dmAutoResponderEnabled": true
```

Configured by that account's `dmAutoResponseRules`.

Each rule can control:

- `anyKeywords`: message text that triggers the rule.
- `excludeKeywords`: message text that blocks the rule.
- `maxRepliesPerSenderPerDay`: cap responses per person.
- `cooldownSeconds`: avoid rapid repeated replies.
- `templates`: randomized responses.

The app remembers which templates each sender has already received for each rule. If all templates for that sender/rule have been used, it does not repeat one.

Example:

```json
[
  {
    "id": "pricing",
    "enabled": true,
    "anyKeywords": ["price", "pricing", "cost", "how much"],
    "excludeKeywords": ["refund", "angry", "scam"],
    "maxRepliesPerSenderPerDay": 2,
    "cooldownSeconds": 3600,
    "templates": [
      "I can help with that. The best starting point is here: https://example.com/pricing",
      "Good question. Pricing depends on the setup, but this page gives the clean overview: https://example.com/pricing",
      "Here is the pricing overview: https://example.com/pricing - send me one detail about what you need and I can point you better."
    ]
  }
]
```

Meta messaging rules still apply. In practice, your app should only respond where Meta allows business messaging, usually when the user initiated the conversation or is inside the allowed response window.

Run locally:

```bash
npm run dev
```

Health check:

```bash
curl http://localhost:3000/health
```

## Meta Setup

Use this checklist in Meta for Developers.

1. Create a Meta Developer app.
   - Use a Business app/app type that supports Instagram Platform products.
   - Add the Instagram product/API setup and Webhooks product.

2. Connect both Instagram Professional accounts to the same Meta app.
   - Each Instagram account must be Business or Creator.
   - For the Instagram API with Instagram Login flow used by this project, Meta documents an Instagram User access token on `graph.instagram.com`; the private replies requirements table does not list a Facebook Page access token.
   - If you choose the Facebook Login for Business path instead, Meta documents a Facebook Page access token flow and says the Professional Instagram account must be linked to a Facebook Page.
   - Each account still needs its own Instagram account ID and usable access token in `INSTAGRAM_ACCOUNTS_JSON`.

3. Choose one auth path.
   - Preferred for this project: Instagram API with Instagram Login / Business Login for Instagram.
   - Host: `graph.instagram.com`
   - Token: Instagram User access token.
   - Permissions for private replies to comments:
     - `instagram_business_basic`
     - `instagram_business_manage_comments`
   - For public comment replies, hiding, and deleting comments, use comment management permissions.
   - For incoming DM autoresponse, Meta documents `instagram_business_manage_messages`.

4. If using Facebook Login for Business instead:
   - Host: `graph.facebook.com`
   - Token: Facebook Page access token.
   - Permissions Meta documents for private replies:
     - `instagram_basic`
     - `instagram_manage_comments`
     - `pages_read_engagement`
   - If the app user was granted a role on the connected Page via Business Manager, Meta also documents `ads_management` and `ads_read` in that scenario.
   - This code is configured for the Instagram Login host. Change `MetaClient` only if you intentionally choose the Facebook Login path.

5. Configure webhooks.
   - Callback URL: `https://your-domain.com/webhook`
   - Verify token: exactly the same string as `META_VERIFY_TOKEN`
   - Subscribe to the Instagram `comments` field.
   - Subscribe to `messages` for incoming DM autoresponse.
   - Subscribe to `messaging_postbacks` if you later add icebreakers, quick replies, or CTA button payload routing.
   - Subscribe to `live_comments` only if you want Live comments. This bot does not need it for posts/reels.

6. Verification challenge.
   - Meta sends `GET /webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`
   - The app returns `hub.challenge` only when the verify token matches.

7. Webhook signatures.
   - Meta signs webhook POST deliveries with `X-Hub-Signature-256: sha256=<hmac>`.
   - The app verifies the HMAC-SHA256 against the raw request body using `META_APP_SECRET`.
   - Keep `VERIFY_META_SIGNATURES=true` in production.

8. Development mode vs live mode.
   - In development mode, only app admins, developers, testers, and test assets can use the app.
   - If the automation is only for your own Instagram accounts and your Meta user/accounts have the required roles, you can test in development mode.
   - For use with accounts or users outside your app roles, switch to Live mode and complete App Review for any permissions that require Advanced Access.

9. App Review.
   - Standard Access can be enough for development and app-role users.
   - Advanced Access/App Review is required for production use beyond app-role users and for permissions Meta marks as requiring review.
   - Prepare a screencast showing: comment keyword, webhook receipt, private reply DM, and settings where the user connects their Instagram account.

10. Tokens.
   - Store access tokens only in environment variables.
   - Business Login for Instagram returns a short-lived Instagram User token that can be exchanged for a long-lived token.
   - Meta documents long-lived Instagram User tokens as valid for 60 days.
   - Refresh long-lived Instagram tokens before expiry with `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=<LONG_LIVED_TOKEN>`.
   - System user tokens may be available for Business-managed production setups.
   - Build an operational process to refresh or rotate tokens before expiration; failed sends will be logged with the Meta error body.

## Persistence

The app uses file-backed persistence:

- `data/processed-comments.json` for dedupe state
- `data/events.jsonl` for delivery logs

This is intentionally small and works best on a single always-on instance such as Railway or Render with a persistent disk. For Vercel/serverless or multiple instances, replace `FileStore` with Redis/Upstash or another shared durable store; otherwise dedupe state can be lost between cold starts or split across instances.

All stored keys are prefixed by the account `id`, so Brand A and Brand B do not share counters, dedupe state, or DM template history.

## Local Webhook Testing

Verify the challenge endpoint:

```bash
curl "http://localhost:3000/webhook?hub.mode=subscribe&hub.verify_token=replace_with_any_random_verify_token&hub.challenge=CHALLENGE_ACCEPTED"
```

For unsigned local testing, temporarily set:

```bash
VERIFY_META_SIGNATURES=false
```

Then send a sample comment webhook:

```bash
curl -X POST "http://localhost:3000/webhook" \
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

To test signature verification locally, generate the signature from the exact JSON body bytes and send it as `X-Hub-Signature-256`.

## Deployment

Build:

```bash
npm run build
```

Start:

```bash
npm start
```

Railway/Render:

- Build command: `npm install && npm run build`
- Start command: `npm start`
- Add all `.env` variables in the service dashboard.
- Mount persistent storage for `data/` if you want dedupe/logs to survive redeploys.

Vercel:

- This Express server is not packaged as a Vercel serverless function by default.
- If you adapt it for Vercel, use a shared durable store such as Upstash Redis for dedupe/logging.

Cloudflare Workers:

- This Express/Node implementation is not Worker-native.
- Port the route logic and use KV/Durable Objects for dedupe if you want Cloudflare.

## Project Structure

```text
src/
  config.ts           Environment parsing
  keywordMatcher.ts   Deterministic case-insensitive keyword matcher
  metaClient.ts       Meta private reply API client and retry handling
  metaSignature.ts    X-Hub-Signature-256 verification
  rulesEngine.ts      Public reply, moderation, and DM autoresponse rules
  server.ts           Express routes
  store.ts            File-backed dedupe and logs
  types.ts            Shared types
  webhookParser.ts    Instagram comment webhook extraction
```

## Limitations

- Meta private replies allow only one private reply to the commenter for a comment-triggered conversation.
- Private replies must be sent within Meta's allowed window. Meta documents 7 days for post/reel/story comments and only during the broadcast for Instagram Live.
- Follow-up messages are only allowed if the recipient responds and must follow Meta's messaging window rules.
- This app processes webhooks synchronously. Keep response text short and hosting latency low.
- File-backed caps and dedupe are intended for one server instance. Use Redis/Upstash for multi-instance or serverless deployment.
- Comment like/reaction automation is not implemented. I did not find a current official Meta endpoint in the verified docs used for this build; add it only after confirming the exact endpoint, permission, and API version in Meta's official docs/app dashboard.

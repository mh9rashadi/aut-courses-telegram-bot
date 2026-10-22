# Operations runbook

What a deployment consists of (all in your own Cloudflare account):
- Worker `aut-courses-bot` → `https://aut-courses-bot.<your-subdomain>.workers.dev` (only `POST /telegram` is served)
- D1 database `aut-courses-bot` (found by name; no id in the repo)
- Your Telegram bot, pointed at the Worker by `npm run setup` / `npm run webhook`

## Secrets

| Name | What | Where |
|---|---|---|
| `BOT_TOKEN` | Telegram bot token (@BotFather) | Cloudflare secret |
| `WEBHOOK_SECRET` | random string; Telegram sends it in a header on every update | Cloudflare secret + Telegram webhook config |
| `TOKEN_KEY` | base64 of 32 random bytes; encrypts the Moodle token in D1 | Cloudflare secret |
| `OWNER_ID` | your numeric Telegram id; only this user can use the bot | Cloudflare secret |
| Moodle token | set through the bot (QR text or `/settoken`) | D1 `kv.moodle_token`, encrypted |

`.dev.vars` (git-ignored) is the local copy of the Cloudflare secrets, written by `npm run setup` and used by the
tools and `wrangler dev`. Keep it private. If you lose it, the bot keeps working; regenerate values as below when
you need them.

Generate values:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"   # WEBHOOK_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"      # TOKEN_KEY
```

## Routine tasks

**Deploy a change:** `npm run check && npm run deploy`.

**Moodle token expired** (bot says so / menu shows the re-login text): send the profile QR text to the bot (README).
Token lifetime is set by the site (Moodle default ~12 weeks); expect to do this a few times a year.

**Rotate the bot token** (e.g. leaked): @BotFather → /revoke → put the new token in `.dev.vars` →
`npx wrangler secret put BOT_TOKEN` → `npm run webhook -- <worker-url>`.

**Rotate `WEBHOOK_SECRET`:** new value in `.dev.vars` → `npx wrangler secret put WEBHOOK_SECRET` → `npm run webhook -- <url>`.

**Rotate `TOKEN_KEY`:** `npx wrangler secret put TOKEN_KEY` → the stored Moodle token can no longer be decrypted →
log in again through the bot.

**Schema change:** add `migrations/000N_name.sql` → `npm run db:migrate` → deploy.

**Update dependencies (yearly is enough):** `npm update && npm run check && npm run deploy`. Bump
`compatibility_date` in `wrangler.jsonc` deliberately and re-test. After changing `wrangler.jsonc` bindings, run
`npm run types`.

## Troubleshooting

| Symptom | Check |
|---|---|
| Bot doesn't answer | `npm run webhook -- --info` → `last_error_message`, `pending_update_count`, url ends with `/telegram`. Dashboard → Workers → aut-courses-bot → Observability for errors. |
| 403 in webhook info | `WEBHOOK_SECRET` in Cloudflare differs from the one given to setWebhook → re-run `npm run webhook -- <url>`. |
| "بررسی خودکار … اجرا نشده" in menu | Cron not running: dashboard → Worker → Settings → Triggers; Observability for `scheduled` errors. Cloudflare status page. |
| "کورسز در دسترس نیست" | Site down or slow (it is often ~4 s/page). Try later. |
| Error 1102 / exceeded CPU in logs | Something parses too much JSON in one invocation (see ARCHITECTURE: free-plan limits). |
| Messages ignored after testing with fake updates | `last_update_id` too high: `npx wrangler d1 execute aut-courses-bot --remote --command "DELETE FROM kv WHERE key='last_update_id'"`. |

Inspect state:
```bash
npx wrangler d1 execute aut-courses-bot --remote --command "SELECT key, value FROM kv WHERE key != 'moodle_token'"
npx wrangler d1 execute aut-courses-bot --remote --command "SELECT course_id, checked_at FROM subscriptions"
```

## Setting up from zero

`npm run setup` does all of this (and is safe to re-run). Manually:

1. Cloudflare account (free) → `npx wrangler login`.
2. `npx wrangler d1 create aut-courses-bot --no-update-config` → `npm run db:migrate`.
3. Create `.dev.vars` with `BOT_TOKEN`, `OWNER_ID`, `WEBHOOK_SECRET`, `TOKEN_KEY` (generate as above).
4. First deploy (secrets must exist before the Worker does): `npx wrangler deploy --secrets-file .dev.vars`.
5. `npm run webhook -- https://aut-courses-bot.<your-subdomain>.workers.dev`.
6. Send `/start` to the bot, then the QR text to log in. Subscribe to courses with the 🔔 button.

## Moving away from Cloudflare

Nothing Cloudflare-specific outside `src/index.ts` (entry), `src/store.ts` (D1) and `wrangler.jsonc`. To move:
replace D1 with SQLite/Postgres in `store.ts`, serve `POST /telegram` from any HTTP server, call `runPoller` from a
timer.

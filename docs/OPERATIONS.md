# Operations runbook

What a deployment consists of (all in your own Cloudflare account):
- Worker `aut-courses-bot` → `https://aut-courses-bot.<your-subdomain>.workers.dev` (only `POST /telegram` is served).
  The name comes from `wrangler.jsonc`; any other Worker in the dashboard (e.g. one made by hand) is not this bot.
- D1 database `aut-courses-bot` (found by name; no id in the repo)
- Your Telegram bot, pointed at the Worker by `npm run setup` / `npm run webhook`

## Secrets

| Name | What | Where |
|---|---|---|
| `BOT_TOKEN` | Telegram bot token (@BotFather) | Cloudflare secret |
| `WEBHOOK_SECRET` | random string; Telegram sends it in a header on every update | Cloudflare secret + Telegram webhook config |
| `TOKEN_KEY` | base64 of 32 random bytes; encrypts the Moodle token in D1 | Cloudflare secret |
| `OWNER_ID` | optional, older installs: your numeric Telegram id. New installs store the owner in D1 `kv.owner_id` when you open the installer's link | Cloudflare secret |
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

**Moodle token expired** (bot says so / menu shows the re-login text): open `install.cmd` (or `npm run installer`)
and do only the "ورود به کورسز" step. Fallback: `npm run qr-token` → send the printed `/settoken …` line to the bot.
Token lifetime is set by the site (Moodle default ~12 weeks); expect to do this a few times a year.

**Rotate the bot token:** @BotFather → /revoke → put the new token in `.dev.vars` →
`npx wrangler secret put BOT_TOKEN` → `npm run webhook -- <worker-url>`.

## If a secret leaked

Leaked = posted in an issue, chat, screenshot or log, or `.dev.vars` copied somewhere. Act on each value that leaked:

| Leaked | What it allows | Do |
|---|---|---|
| Bot token (BotFather) | Anyone can act as your bot, read updates, change its webhook | "Rotate the bot token" above. The old token stops working at once. |
| QR text (`qrlogin=…`) | Logging in as you until it expires (10 min, one use) | Usually nothing to do if > 10 min passed. If it may have been used, treat it like a leaked Moodle token. |
| `/settoken …` line (Moodle token) | Full access to your courses account until the token expires or is revoked | `/logout` only removes it from the bot, **not** from Moodle. Students can't list or revoke their tokens on this site (`/user/managetoken.php` is hidden), so ask the site support/admin to revoke your mobile-app tokens, then log in again. Changing the account password may not revoke it. |
| `WEBHOOK_SECRET` | Sending fake updates to the Worker (still only acted on for the owner) | "Rotate `WEBHOOK_SECRET`" above. |
| `TOKEN_KEY` | Decrypting the Moodle token, but only together with a D1 export | "Rotate `TOKEN_KEY`" above, then log in again. |

When asking for help, share error codes (`ipmismatch`, `expiredkey`, `wrangler deploy failed` + the message) and
replace ids/URLs with placeholders. None of the tools print secrets except `qr-token`'s final `/settoken` line,
which is meant only for your own bot.

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
| Installer stuck on "وصل کردن تلگرام" | Normal for a few minutes with a new workers.dev name. It retries; cron also connects the bot within ~5–15 min. Check `kv.setup_status`: `npx wrangler d1 execute aut-courses-bot --remote --command "SELECT value FROM kv WHERE key='setup_status'"`. |
| `Authentication error [code: 10000]` after switching Cloudflare accounts | wrangler's per-project account cache. The installer clears it; by hand: delete `node_modules/.cache/wrangler/wrangler-account.json`. |
| `setup`: "no workers.dev subdomain" / wrangler "register a workers.dev subdomain" | New Cloudflare account. Dashboard → Workers & Pages → pick a subdomain → wait a minute → `npm run setup` again (saved secrets and the database are reused). |
| Login: `ipmismatch` | The site accepts a QR only from the IP that displayed it; the Worker's IP differs. New QR → `npm run qr-token` on the same computer and network as the browser. Don't resend the same QR, and don't try to spoof IPs or headers. |
| Login: `expiredkey` / `invalidkey` | QR older than 10 min or already used. Show a new QR and redeem it right away. |
| Bot says it couldn't delete a secret message | Delete the message yourself in Telegram (bot messages/permissions). |
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
3. Create `.dev.vars` with `BOT_TOKEN`, `WEBHOOK_SECRET`, `TOKEN_KEY` (generate as above), and `OWNER_ID` (your
   numeric Telegram id) since there is no installer link to claim the bot.
4. First deploy (secrets must exist before the Worker does): `npx wrangler deploy --secrets-file .dev.vars`.
5. `npm run webhook -- https://aut-courses-bot.<your-subdomain>.workers.dev`.
6. Send `/start` to the bot, log in with `npm run installer` (step 5) or `npm run qr-token` + `/settoken`.
   Subscribe to courses with the 🔔 button.

Before step 4 the account needs a workers.dev subdomain (once per account; dashboard → Workers & Pages).

## Removing the bot

`uninstall.cmd` / `npm run uninstall` (asks for `yes`; `--yes` skips, `--logout` also logs wrangler out): deletes the
Telegram webhook, the Worker, the D1 database (with the stored login) and the local `.dev.vars` and
`.installer-state.json`. Parts that are already gone are skipped, so it is safe to repeat.

**Changing the owner** (new installs): `npx wrangler d1 execute aut-courses-bot --remote --command "DELETE FROM kv WHERE key='owner_id'"`,
delete the local `.installer-state.json`, then open the installer again: step 4 shows a new link.

## Moving away from Cloudflare

Nothing Cloudflare-specific outside `src/index.ts` (entry), `src/store.ts` (D1) and `wrangler.jsonc`. To move:
replace D1 with SQLite/Postgres in `store.ts`, serve `POST /telegram` from any HTTP server, call `runPoller` from a
timer.

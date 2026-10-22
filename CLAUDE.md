# CLAUDE.md

Personal Telegram bot for courses.aut.ac.ir (Moodle) on Cloudflare Workers + D1. Single user per deployment
(public repo: each student deploys their own). Users speak Persian; bot UI text is Persian, code/comments/docs are English.

Read first: `docs/ARCHITECTURE.md` (design + free-plan limits), `docs/OPERATIONS.md` (deploy, secrets, runbook).
Open items: `docs/BACKLOG.md` — update it when you finish or discover something.

## Commands
- `npm run check` — tsc + vitest. Run before every deploy.
- `npm run deploy` — needs `npx wrangler whoami` to show the owner's Cloudflare account.
- `npm run webhook -- --info` — Telegram webhook state.
- `npx wrangler d1 execute aut-courses-bot --remote --command "…"` — inspect state.

## Rules
- No runtime dependencies. Telegram/Moodle clients are hand-written on purpose.
- Free plan: 10 ms CPU per invocation (network wait is free, JSON parsing is not), 50 subrequests. The poller
  must stay within this — see ARCHITECTURE.
- All SQL lives in `src/store.ts`. Schema changes = new file in `migrations/`, never edit applied ones.
- Never print or commit secrets or personal data (Telegram ids, Cloudflare account ids, emails, Moodle user ids):
  the repo is public. `.dev.vars` is the git-ignored local file with real values.
  When a command needs a secret, read it inside the command; don't echo it.
- Callback data ≤ 64 bytes; new buttons go in the `BUTTONS` table in `src/bot/router.ts`.
- Simulating updates against production: use update_ids above the real ones, then delete
  `kv.last_update_id` afterwards (otherwise real messages are dropped as duplicates).
- The local network may be on a VPN that breaks `wrangler tail`; use the dashboard Observability page instead.

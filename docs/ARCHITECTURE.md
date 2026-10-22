# Architecture

## Overview

```
Telegram ──webhook POST /telegram──▶ Worker.fetch ──▶ bot/router ──▶ handlers ──▶ Moodle WS (courses.aut.ac.ir)
                                                                   └──────────▶ Telegram Bot API (replies, files)
Cron */5 min ─────────────────────▶ Worker.scheduled ──▶ poller ──▶ Moodle WS ──▶ Telegram (notifications)
                                         both ──▶ D1 (state)
```

One Worker, one D1 database, no other services. Single user (`OWNER_ID`).

## Why these choices

| Decision | Reason |
|---|---|
| Cloudflare Workers, free plan | Always on, no server to maintain, $0. Tested: Workers reach courses.aut.ac.ir and api.telegram.org (neither is reachable from inside Iran, so the bot must run abroad anyway). |
| Webhook, not polling | A Worker only runs when called. Telegram calls it per update. |
| D1, not KV | Strongly consistent (the upload flow reads what the previous message wrote), SQL migrations for schema changes, generous free writes (100k/day vs KV's 1k/day). |
| No runtime dependencies | Telegram and Moodle clients are small and hand-written; Jalali dates use the built-in `Intl` persian calendar. Nothing to update or break over the years. `@grammyjs/types` is type-only. |
| Token encrypted with `TOKEN_KEY` | A database export alone does not reveal the Moodle token (which gives full account access). |
| QR **text** instead of QR photo | Decoding an image in a Worker would exceed the free plan's 10 ms CPU limit. Phone cameras read the QR text natively. |
| Updates processed inline, `max_connections=1` | File transfers can exceed `waitUntil`'s 30 s. One connection = updates in order, no races on state. Retries are deduped with `last_update_id`. |

## Free-plan limits that shape the code

- **10 ms CPU per invocation** (network wait not counted). Parsing full contents of all 7 subscribed courses at once
  measured ~10.5 ms. So the poller calls `core_course_get_updates_since` (tiny response) per course and downloads full
  contents for at most `MAX_CONTENT_FETCHES` (=1) course per run; others follow on later runs.
- **Measured CPU (2026-10-22, after optimisation)**: `/start` ~5 ms, course screens ~10–15 ms, deadlines ~15 ms,
  cron ~20 ms, sending a 23 MB file ~10 ms (streamed). Several are above 10 ms, yet Cloudflare returned **0 errors**:
  in practice the free plan tolerates short overruns. If the Observability page ever shows error 1102 /
  `exceededCpu`, look first at: JSON parsing of big Moodle responses, D1 round trips per update (each costs ~1 ms;
  use `store.getMany`), and anything that buffers file bytes in JS instead of streaming
  (`Telegram.sendDocumentStream`). The assignment upload path still buffers (≤ 20 MB, rare).
- **50 subrequests per invocation**: poller sends at most 15 changes / 10 notifications per run.
- **Telegram cloud Bot API**: bot sends files ≤ 50 MB, downloads user files ≤ 20 MB (`telegram/api.ts`).
  Larger course files (many lecture `.rar`s) are refused with a message to use the site.
- **Cron**: best effort; a run can be skipped or delayed (no retries). The menu warns if the last run
  (`last_cron_at`) is older than 1 h. New/changed cron schedules take up to ~15 min to start firing.

## Request flow (webhook)

1. `index.ts` checks method/path and the `X-Telegram-Bot-Api-Secret-Token` header (constant-time compare).
2. `router.handleUpdate`: non-owner → reply with their id and stop. Skip if `update_id <= last_update_id`.
3. Messages: `/commands` → handlers; QR text → login; file during an upload session → upload; otherwise menu.
   Buttons: `callback_data = "<name>:<args>"` → `BUTTONS[name]` (table in `router.ts`).
4. Handlers render with `ctx.show()` (edits the panel message for buttons, sends a new one for commands).
5. Errors: `TokenInvalid` → re-login text; Moodle network → "unavailable"; others logged + generic message.
   The webhook always returns 200 so Telegram doesn't retry forever.

## Background run (cron)

`poller/index.ts`, three independent steps (one failing doesn't block the others):
1. **Content**: per subscribed course, `updates_since(checked_at)`; if changed, fetch contents, `takeSnapshot`,
   `diffSnapshots` against the stored snapshot, message new activities/files. First check after subscribing only
   stores the baseline.
2. **Deadlines**: `core_calendar_get_action_events_by_timesort`; one reminder per event per window (3 h / 24 h),
   remembered in `sent_reminders` (pruned after 30 days).
3. **Notifications**: Moodle popup notifications with id > `last_notification_id` (first run only sets the baseline).
   `coursecontentupdated` is skipped (step 1 covers it).
On `TokenInvalid` the owner is told once (`token_alerted`, reset on login). Ends by writing `last_cron_at`.

## Data (D1)

See `migrations/`. `kv` holds small JSON values; the typed list of keys is `KvValues` in `store.ts`.
`subscriptions` holds per-course snapshot + `checked_at`; `sent_reminders` dedupes reminders.
Schema changes: add `migrations/000N_*.sql`, run `npm run db:migrate`, never edit an applied migration.

## Adding a feature (checklist)

- New screen: handler in `bot/handlers/`, register its callback name in `BUTTONS` (`router.ts`); keep callback data
  under 64 bytes.
- New Moodle call: method in `moodle/client.ts` + response type in `moodle/types.ts`. Check the function is
  available to the mobile service (site has 429 functions; e.g. `core_files_upload` is not, hence `upload.php`).
- New stored value: add the key to `KvValues`, or a migration for a table.
- Anything in the poller: mind the 10 ms CPU / 50 subrequest budget.
- Run `npm run check`, then `npm run deploy`.

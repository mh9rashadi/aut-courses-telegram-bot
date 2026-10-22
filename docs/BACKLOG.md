# Backlog

Known gaps and ideas, roughly by value. Contributions welcome. Pick one, read ARCHITECTURE.md, change, `npm run check`, `npm run deploy`.

## Verify on first real use
- [ ] **Assignment submission** (📤 upload → ✅ ثبت → ارسال نهایی) was not tested end-to-end on v2, to avoid changing
      real submissions. Logic matches v1. Watch the first real submission; check Observability if it fails.
- [x] **QR login from Cloudflare's IP**: a real install (2026-10-22) got `ipmismatch` (site has the QR same-IP check
      on). `npm run qr-token` is now the main documented path; the bot explains `ipmismatch`/`expiredkey`.
- [ ] **Fresh Cloudflare account without workers.dev subdomain**: the installer checks it before creating anything
      (API `accounts/:id/workers/subdomain`), but a brand-new test account already had one, so the "missing" branch
      is untested on a real account.
- [ ] **Browser installer on a clean Windows machine** (2026-10-23): tested end to end on an existing test account
      (install, all three Telegram paths, QR paste with a fake key). Not yet: double-clicking `install.cmd` from a
      fresh ZIP with no Node.js, and a real QR login through the page.
- [ ] Mac/Linux: no double-click launcher (`npm run installer` in a terminal).

## Improvements
- [ ] Stream assignment uploads too (Telegram → Moodle `upload.php`), like `sendDocumentStream`; today files are
      buffered (≤ 20 MB each, CPU spike on big uploads).
- [ ] Files > 50 MB (many lecture `.rar`s): only possible with a self-hosted Telegram Bot API server (needs a VPS),
      or by sending a link. A link needs the token in the URL — don't, unless via a short-lived proxy in the Worker
      (`GET /file/<signed-id>` that streams from Moodle; signature with a secret, expiry ~10 min).
- [ ] Token expiry warning before it happens: Moodle doesn't expose expiry to students; could track token age
      (`kv` timestamp on login) and remind after ~11 weeks.
- [ ] Filter `core_course_get_updates_since` to relevant update names to save content fetches on noisy courses.
- [ ] Weekly summary message (deadlines of the coming week) — one more cron schedule (free plan allows 5).

## Maintenance calendar
- Each term: nothing required; new courses appear automatically (current term = highest term code). Re-subscribe
  (🔔) to the new term's courses.
- Yearly: `npm update`, bump `compatibility_date`, `npm run check`, deploy (OPERATIONS.md).
- If Cloudflare changes the free plan: see "Moving away from Cloudflare" in OPERATIONS.md.

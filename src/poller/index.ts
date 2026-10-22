// Background run (Cron Trigger, every 5 minutes):
//   1. new content in subscribed courses
//   2. deadline reminders 24 h and 3 h before
//   3. new Moodle popup notifications
// then records a heartbeat (last_cron_at) that the menu checks.
//
// Free-plan budget per run: 10 ms CPU and 50 subrequests. Waiting on the network is free, parsing JSON is not.
// So content checks use the cheap core_course_get_updates_since first and download full course contents
// for at most MAX_CONTENT_FETCHES courses per run; the rest are picked up on later runs.

import { btn, esc, fmtLeft, fmtTime, kb, stripHtml, urlBtn } from "../telegram/format";
import { Moodle, TokenInvalid } from "../moodle/client";
import { Store } from "../store";
import { Telegram } from "../telegram/api";
import { RELOGIN_TEXT, modIcon } from "../bot/texts";
import { cmidFromUrl } from "../bot/handlers/menu";
import { diffSnapshots, takeSnapshot, type Change } from "./snapshot";

const MAX_CONTENT_FETCHES = 1;
const REMINDER_WINDOWS: [label: string, seconds: number][] = [["3h", 3 * 3600], ["24h", 24 * 3600]];
/** Covered by our own content diff, so not forwarded twice. */
const SKIP_NOTIFICATION_TYPES = new Set(["coursecontentupdated"]);

interface Run {
  env: Env;
  store: Store;
  tg: Telegram;
  moodle: Moodle;
  owner: number;
  now: number;
}

export async function runPoller(env: Env): Promise<void> {
  const store = new Store(env.DB, env.TOKEN_KEY);
  const tg = new Telegram(env.BOT_TOKEN);
  const owner = Number(env.OWNER_ID);
  const token = await store.getToken();
  if (!token) return; // not logged in yet; nothing to check

  const run: Run = { env, store, tg, moodle: new Moodle(env.MOODLE_URL, token), owner,
    now: Math.floor(Date.now() / 1000) };
  try {
    // Each step is independent: one failing (e.g. Moodle hiccup) must not block the others.
    for (const step of [checkContent, checkDeadlines, checkNotifications]) {
      try {
        await step(run);
      } catch (err) {
        if (err instanceof TokenInvalid) throw err;
        console.error(`poller step ${step.name} failed`, err);
      }
    }
  } catch (err) {
    if (!(err instanceof TokenInvalid)) throw err;
    if (!(await store.get("token_alerted"))) {
      await tg.sendMessage(owner, RELOGIN_TEXT);
      await store.set("token_alerted", true);
    }
  }
  await store.set("last_cron_at", run.now);
}

// --- 1. course content -----------------------------------------------------------------

async function checkContent(run: Run): Promise<void> {
  let fetches = 0;
  for (const sub of await run.store.subscriptions()) {
    if (sub.snapshot && sub.checkedAt) {
      const updates = await run.moodle.updatesSince(sub.courseId, sub.checkedAt);
      if (!updates.length) {
        await run.store.touchSubscription(sub.courseId, run.now);
        continue;
      }
    }
    if (fetches++ >= MAX_CONTENT_FETCHES) continue; // leave checked_at as is: retried next run
    const snapshot = takeSnapshot(await run.moodle.contents(sub.courseId));
    // First check after subscribing only records the baseline (no flood of "new" messages).
    const changes = sub.snapshot ? diffSnapshots(sub.snapshot, snapshot) : [];
    await sendChanges(run, sub.courseId, changes);
    await run.store.saveSnapshot(sub.courseId, snapshot, run.now);
  }
}

async function sendChanges(run: Run, courseId: number, changes: Change[]): Promise<void> {
  if (!changes.length) return;
  const lines = ["🆕 <b>محتوای جدید در کورسز</b>"];
  for (const ch of changes.slice(0, 15)) {
    const what = ch.kind === "new" ? "فعالیت جدید" : "فایل جدید/به‌روز";
    lines.push(`\n${modIcon(ch.module.mod)} <b>${esc(ch.module.name)}</b> — ${what}` +
      (ch.module.section ? `\n📂 ${esc(ch.module.section)}` : "") +
      (ch.files.length ? `\n📎 ${ch.files.slice(0, 5).map(esc).join("، ")}` : ""));
  }
  const first = changes[0]!;
  await run.tg.sendMessage(run.owner, lines.join("\n"), { reply_markup: kb([
    [btn(`${modIcon(first.module.mod)} ${first.module.name}`, `m:${courseId}:${first.cmid}`)],
    [btn("📚 باز کردن درس", `c:${courseId}`)],
  ]) });
}

// --- 2. deadline reminders -----------------------------------------------------------

async function checkDeadlines(run: Run): Promise<void> {
  const events = await run.moodle.actionEvents(run.now);
  for (const ev of events) {
    const left = ev.timesort - run.now;
    // Smallest window first: a deadline 2 h away gets only the "3h" reminder, not both.
    const window = REMINDER_WINDOWS.find(([, seconds]) => left > 0 && left <= seconds);
    if (!window) continue;
    const key = `${ev.id}:${window[0]}`;
    if (await run.store.reminderSent(key)) continue;
    const name = ev.activityname || ev.name;
    const cmid = cmidFromUrl(ev.url);
    await run.tg.sendMessage(run.owner,
      `⏰ <b>یادآوری ددلاین</b>\n\n${modIcon(ev.modulename)} <b>${esc(name)}</b>\n` +
      `📚 ${esc(ev.course?.fullname ?? "")}\n📅 ${fmtTime(ev.timesort)}\n${fmtLeft(ev.timesort, run.now)}`,
      { reply_markup: kb([
        ev.modulename === "assign" && cmid && ev.course ? [btn("📝 مشاهده‌ی تکلیف", `a:${ev.course.id}:${cmid}`)] : null,
        ev.url ? [urlBtn("🌐 در کورسز", ev.url)] : null,
      ]) });
    await run.store.markReminder(key);
  }
  await run.store.pruneReminders();
}

// --- 3. Moodle notifications ---------------------------------------------------------

async function checkNotifications(run: Run): Promise<void> {
  const userid = await run.store.get("moodle_userid") ?? (await run.moodle.siteInfo()).userid;
  const items = await run.moodle.notifications(userid, 20);
  const lastId = await run.store.get("last_notification_id");
  const newest = Math.max(0, ...items.map((n) => n.id));
  if (lastId === null) {
    // First run: remember where we are instead of forwarding old notifications.
    await run.store.set("last_notification_id", newest);
    return;
  }
  const fresh = items.filter((n) => n.id > lastId && !SKIP_NOTIFICATION_TYPES.has(n.eventtype ?? ""))
    .sort((a, b) => a.id - b.id);
  for (const n of fresh.slice(0, 10)) {
    const body = stripHtml(n.smallmessage, 600);
    await run.tg.sendMessage(run.owner,
      `🔔 <b>${esc(n.subject)}</b>\n🕓 ${fmtTime(n.timecreated)}${body && body !== n.subject ? `\n\n${esc(body)}` : ""}`,
      n.contexturl ? { reply_markup: kb([[urlBtn("🌐 در کورسز", n.contexturl)]]) } : {});
  }
  if (newest > lastId) await run.store.set("last_notification_id", newest);
}

// Home menu, deadlines, Moodle notifications and the status screen.

import { TokenInvalid } from "../../moodle/client";
import { btn, esc, fa, fmtLeft, fmtTime, kb, type Button } from "../../telegram/format";
import type { Ctx } from "../context";
import { HOME_TEXT, RELOGIN_TEXT, homeBtn, mainMenu, modIcon } from "../texts";
import { courseTitle } from "./courses";

/** Cron runs every 5 minutes; warn if it has been silent much longer than that. */
const HEARTBEAT_STALE_SECONDS = 60 * 60;

export async function home(ctx: Ctx): Promise<void> {
  const state = await ctx.store.getMany("moodle_token", "last_cron_at", "upload");
  if (state.upload) await ctx.store.delete("upload"); // going home cancels a submission in progress
  if (!state.moodle_token) {
    await ctx.show(RELOGIN_TEXT);
    return;
  }
  await ctx.show(HOME_TEXT + heartbeatWarning(state.last_cron_at), mainMenu());
}

function heartbeatWarning(lastCron: number | undefined): string {
  if (lastCron && Date.now() / 1000 - lastCron < HEARTBEAT_STALE_SECONDS) return "";
  return `\n\n⚠️ بررسی خودکار (اعلان‌ها) از ${lastCron ? fmtTime(lastCron) : "ابتدا"} اجرا نشده است.`;
}

export async function deadlines(ctx: Ctx): Promise<void> {
  const moodle = await ctx.moodle();
  const events = await moodle.actionEvents(Math.floor(Date.now() / 1000) - 86400);
  if (!events.length) {
    await ctx.show("🎉 ددلاین بازی نداری.", mainMenu());
    return;
  }
  const lines = ["<b>⏰ ددلاین‌ها</b>"];
  const rows: Button[][] = [];
  for (const ev of events.slice(0, 30)) {
    const name = ev.activityname || ev.name;
    lines.push(`\n${modIcon(ev.modulename)} <b>${esc(name)}</b>\n📚 ${esc(ev.course ? courseTitle(ev.course) : "")}` +
      `\n📅 ${fmtTime(ev.timesort)}  ${fmtLeft(ev.timesort)}`);
    const cmid = cmidFromUrl(ev.url);
    if (ev.modulename === "assign" && cmid && ev.course) rows.push([btn(`📝 ${name}`, `a:${ev.course.id}:${cmid}`)]);
  }
  rows.push([homeBtn()]);
  await ctx.show(lines.join("\n"), kb(rows));
}

export function cmidFromUrl(url: string | undefined): number | null {
  const m = /[?&]id=(\d+)/.exec(url ?? "");
  return m ? Number(m[1]) : null;
}

export async function notifications(ctx: Ctx): Promise<void> {
  const moodle = await ctx.moodle();
  const userid = await ctx.store.get("moodle_userid") ?? (await moodle.siteInfo()).userid;
  const items = await moodle.notifications(userid, 10);
  const lines = ["<b>🔔 آخرین اعلان‌های کورسز</b>"];
  for (const n of items) {
    lines.push(`\n${n.read ? "" : "🆕 "}<b>${esc(n.subject)}</b>\n🕓 ${fmtTime(n.timecreated)}`);
  }
  await ctx.show(items.length ? lines.join("\n") : "اعلانی نیست.", kb([[homeBtn()]]));
}

export async function status(ctx: Ctx): Promise<void> {
  let conn: string;
  let titles = new Map<number, string>();
  try {
    const moodle = await ctx.moodle();
    const info = await moodle.siteInfo();
    conn = `✅ متصل به‌عنوان <b>${esc(info.fullname)}</b>`;
    titles = new Map((await moodle.courses(info.userid)).map((c) => [c.id, courseTitle(c)]));
  } catch (err) {
    if (!(err instanceof TokenInvalid)) throw err;
    conn = "❌ توکن نامعتبر است — لینک QR را بفرست";
  }
  const subs = (await ctx.store.subscriptions())
    .map((s) => `• ${esc(titles.get(s.courseId) ?? s.courseId)}`).join("\n") || "—";
  const lastCron = await ctx.store.get("last_cron_at");
  await ctx.show(
    `<b>⚙️ وضعیت</b>\n${conn}\n\n🔔 درس‌های دارای اعلان:\n${subs}\n\n` +
    `⏱ بررسی خودکار هر ${fa(5)} دقیقه\nآخرین بررسی: ${fmtTime(lastCron)}`,
    kb([[homeBtn()]]),
  );
}

// Course browsing: term lists, course → sections → activities, files, forums, subscriptions.

import type { Course, Module, ModuleContent, Section } from "../../moodle/types";
import { MAX_SEND_BYTES } from "../../telegram/api";
import { btn, esc, fa, fmtSize, fmtTime, kb, stripHtml, urlBtn, type Button } from "../../telegram/format";
import type { Ctx } from "../context";
import { homeBtn, modIcon } from "../texts";
import { assignment } from "./assignments";

/** Telegram keyboards get unwieldy (and can hit size limits) beyond this many buttons. */
const MAX_BUTTONS = 90;

export const courseTitle = (c: Course) => c.fullname || c.displayname || c.shortname;

/** "4051 - 2519063 - ..." → "4051"; old style "14041 - ..." → "4041". */
export function termCode(shortname: string): string {
  let code = shortname.split(" - ", 1)[0]!.trim();
  if (code.length === 5 && code.startsWith("1")) code = code.slice(1);
  return /^\d+$/.test(code) ? code : "0";
}

export const currentTerm = (courses: Course[]) =>
  courses.map((c) => termCode(c.shortname)).reduce((a, b) => (b > a ? b : a), "0");

const visible = (s: Section) => (s.modules ?? []).filter((m) => m.uservisible !== false);
const files = (m: Module) => (m.contents ?? []).filter((c) => c.type === "file");

async function loadCourses(ctx: Ctx): Promise<Course[]> {
  const moodle = await ctx.moodle();
  const userid = await ctx.store.get("moodle_userid") ?? (await moodle.siteInfo()).userid;
  return (await moodle.courses(userid)).sort((a, b) => courseTitle(a).localeCompare(courseTitle(b), "fa"));
}

/** terms:cur | terms:all */
export async function terms(ctx: Ctx, [which]: string[]): Promise<void> {
  let courses = await loadCourses(ctx);
  let title: string;
  if (which === "cur") {
    const term = currentTerm(courses);
    courses = courses.filter((c) => termCode(c.shortname) === term);
    title = `📚 درس‌های ترم جاری (${fa(term)})`;
  } else {
    courses.sort((a, b) => termCode(b.shortname).localeCompare(termCode(a.shortname)));
    title = "🗂 همه‌ی درس‌ها";
  }
  const subscribed = new Set((await ctx.store.subscriptions()).map((s) => s.courseId));
  const rows = courses.slice(0, MAX_BUTTONS)
    .map((c) => [btn(`${subscribed.has(c.id) ? "🔔 " : ""}${courseTitle(c)}`, `c:${c.id}`)]);
  rows.push([homeBtn()]);
  await ctx.show(`<b>${title}</b>\n🔔 = اعلان محتوای جدید روشن`, kb(rows));
}

/** c:<courseId> */
export async function course(ctx: Ctx, [cid]: string[]): Promise<void> {
  const courseId = Number(cid);
  const moodle = await ctx.moodle();
  const [courses, sections] = await Promise.all([loadCourses(ctx), moodle.contents(courseId)]);
  const found = courses.find((c) => c.id === courseId);
  const rows: Button[][] = [];
  sections.forEach((sec, i) => {
    const count = visible(sec).length;
    if (count) rows.push([btn(`${sec.name || `بخش ${fa(i)}`} (${fa(count)})`, `s:${courseId}:${i}`)]);
  });
  const sub = await ctx.store.isSubscribed(courseId);
  rows.push([btn("📝 تکلیف‌ها", `asg:${courseId}`),
    btn(sub ? "🔕 خاموش کردن اعلان" : "🔔 روشن کردن اعلان", `sub:${courseId}`)]);
  rows.push([btn("⬅️ درس‌ها", "terms:cur"), homeBtn()]);
  await ctx.show(`<b>${esc(found ? courseTitle(found) : courseId)}</b>\n` +
    `اعلان محتوای جدید: ${sub ? "روشن 🔔" : "خاموش"}`, kb(rows));
}

/** sub:<courseId> — toggle new-content notifications. */
export async function toggleSubscription(ctx: Ctx, args: string[]): Promise<void> {
  const on = await ctx.store.toggleSubscription(Number(args[0]));
  await ctx.answer(on ? "اعلان روشن شد 🔔" : "اعلان خاموش شد");
  await course(ctx, args);
}

/** s:<courseId>:<sectionIndex> */
export async function section(ctx: Ctx, [cid, idx]: string[]): Promise<void> {
  const courseId = Number(cid);
  const sec = (await (await ctx.moodle()).contents(courseId))[Number(idx)];
  if (!sec) return course(ctx, [String(courseId)]);
  const rows = visible(sec).slice(0, MAX_BUTTONS)
    .map((m) => [btn(`${modIcon(m.modname)} ${m.name}`, `m:${courseId}:${m.id}`)]);
  rows.push([btn("⬅️ درس", `c:${courseId}`), homeBtn()]);
  const summary = stripHtml(sec.summary, 600);
  await ctx.show(`<b>${esc(sec.name)}</b>${summary ? `\n\n${esc(summary)}` : ""}`, kb(rows));
}

async function findModule(ctx: Ctx, courseId: number, cmid: number) {
  const sections = await (await ctx.moodle()).contents(courseId);
  for (const [index, sec] of sections.entries()) {
    const mod = sec.modules?.find((m) => m.id === cmid);
    if (mod) return { index, mod };
  }
  return null;
}

/** m:<courseId>:<cmid> — one activity. */
export async function module(ctx: Ctx, [cid, cm]: string[]): Promise<void> {
  const courseId = Number(cid);
  const found = await findModule(ctx, courseId, Number(cm));
  if (!found) {
    await ctx.answer("پیدا نشد؛ شاید حذف شده", true);
    return;
  }
  await ctx.answer();
  const { index, mod } = found;
  if (mod.modname === "assign") return assignment(ctx, [cid!, cm!]);

  let text = `${modIcon(mod.modname)} <b>${esc(mod.name)}</b>`;
  const desc = stripHtml(mod.description, 1200);
  if (desc) text += `\n\n${esc(desc)}`;
  const rows: Button[][] = [];

  if (mod.modname === "url" && mod.contents?.[0]) {
    rows.push([urlBtn("🔗 باز کردن لینک", mod.contents[0].fileurl)]);
  } else if (mod.modname === "forum") {
    const discussions = await (await ctx.moodle()).forumDiscussions(mod.instance);
    for (const d of discussions) {
      text += `\n\n━━━━━━\n<b>${esc(d.subject)}</b>\n🕓 ${fmtTime(d.timemodified)}\n${esc(stripHtml(d.message, 400))}`;
    }
  } else {
    const list = files(mod);
    if (list.length) text += `\n\n${fa(list.length)} فایل:`;
    list.slice(0, MAX_BUTTONS).forEach((f, i) =>
      rows.push([btn(`⬇️ ${f.filename} (${fmtSize(f.filesize)})`, `f:${courseId}:${mod.id}:${i}`)]));
  }
  if (mod.url) rows.push([urlBtn("🌐 در کورسز", mod.url)]);
  rows.push([btn("⬅️ بخش", `s:${courseId}:${index}`), homeBtn()]);
  await ctx.show(text, kb(rows));
}

/** f:<courseId>:<cmid>:<fileIndex> — send one file of an activity. */
export async function file(ctx: Ctx, [cid, cm, i]: string[]): Promise<void> {
  const found = await findModule(ctx, Number(cid), Number(cm));
  const f = found && files(found.mod)[Number(i)];
  if (f) await sendMoodleFile(ctx, f);
}

/** Download a file from Moodle and send it as a Telegram document (≤ 50 MB). */
export async function sendMoodleFile(ctx: Ctx, f: ModuleContent): Promise<void> {
  if ((f.filesize ?? 0) > MAX_SEND_BYTES) {
    await ctx.send(`📦 <b>${esc(f.filename)}</b> (${fmtSize(f.filesize)}) از سقف ۵۰ مگابایتی ارسال ربات‌های ` +
      "تلگرام بزرگ‌تر است؛ از سایت کورسز دانلودش کن.");
    return;
  }
  const note = await ctx.send(`⏳ در حال دانلود ${esc(f.filename)} …`);
  try {
    const resp = await (await ctx.moodle()).download(f.fileurl);
    const length = Number(resp.headers.get("content-length"));
    if (resp.body && length > 0) await ctx.tg.sendDocumentStream(ctx.chatId, resp.body, length, f.filename);
    else await ctx.tg.sendDocument(ctx.chatId, await resp.blob(), f.filename); // size unknown: buffer it
  } finally {
    await ctx.tg.deleteMessage(ctx.chatId, note.message_id).catch(() => {});
  }
}

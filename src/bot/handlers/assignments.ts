// Assignments: list, details, attachments, and the submission flow
// (collect files in Telegram → upload to a Moodle draft area → save → optional final submit).

import type { Document, PhotoSize } from "@grammyjs/types";
import { assignConfig, MoodleError } from "../../moodle/client";
import type { Assignment, SubmissionStatus } from "../../moodle/types";
import { MAX_RECEIVE_BYTES } from "../../telegram/api";
import { btn, esc, fa, fmtLeft, fmtSize, fmtTime, kb, stripHtml, type Button } from "../../telegram/format";
import type { Ctx } from "../context";
import { SUBMISSION_STATUS, homeBtn, mainMenu } from "../texts";
import { sendMoodleFile } from "./courses";

async function findAssignment(ctx: Ctx, courseId: number, cmid: number): Promise<Assignment | undefined> {
  return (await (await ctx.moodle()).assignments(courseId)).find((a) => a.cmid === cmid);
}

function statusLine(status: SubmissionStatus): string {
  const s = status.lastattempt?.submission?.status;
  return (s && SUBMISSION_STATUS[s]) || s || "—";
}

/** asg:<courseId> */
export async function list(ctx: Ctx, [cid]: string[]): Promise<void> {
  const assigns = (await (await ctx.moodle()).assignments(Number(cid)))
    .sort((a, b) => (b.duedate || 0) - (a.duedate || 0));
  const rows = assigns.slice(0, 90).map((a) => [btn(`📝 ${a.name}`, `a:${cid}:${a.cmid}`)]);
  rows.push([btn("⬅️ درس", `c:${cid}`), homeBtn()]);
  await ctx.show(assigns.length ? "<b>📝 تکلیف‌ها</b>" : "این درس تکلیفی ندارد.", kb(rows));
}

/** a:<courseId>:<cmid> */
export async function assignment(ctx: Ctx, [cid, cm]: string[]): Promise<void> {
  const assign = await findAssignment(ctx, Number(cid), Number(cm));
  if (!assign) {
    await ctx.show("تکلیف پیدا نشد.", kb([[btn("⬅️ درس", `c:${cid}`)]]));
    return;
  }
  const status = await (await ctx.moodle()).submissionStatus(assign.id);
  const last = status.lastattempt ?? {};
  const lines = [`📝 <b>${esc(assign.name)}</b>`, `📅 مهلت: ${fmtTime(assign.duedate)}`];
  if (assign.duedate) lines.push(fmtLeft(assign.duedate));
  if (assign.cutoffdate) lines.push(`🚫 آخرین مهلت: ${fmtTime(assign.cutoffdate)}`);
  lines.push(`وضعیت: ${statusLine(status)}`);
  const submitted = (last.submission?.plugins ?? [])
    .flatMap((p) => p.fileareas ?? []).flatMap((a) => a.files ?? []);
  if (submitted.length) lines.push(`فایل‌های تحویلی: ${submitted.map((f) => esc(f.filename)).join("، ")}`);
  if (status.feedback?.gradefordisplay) lines.push(`🏅 نمره: ${esc(stripHtml(status.feedback.gradefordisplay, 100))}`);
  const intro = stripHtml(assign.intro, 1500);
  if (intro) lines.push(`\n${esc(intro)}`);

  const rows: Button[][] = (assign.introattachments ?? []).slice(0, 20)
    .map((f, i) => [btn(`📎 ${f.filename} (${fmtSize(f.filesize)})`, `af:${cid}:${cm}:${i}`)]);
  if ((last.caneditowner ?? last.canedit) && assignConfig(assign, "file", "enabled") === "1") {
    rows.push([btn("📤 تحویل / جایگزینی فایل", `up:${cid}:${cm}`)]);
  }
  if (last.cansubmit) rows.push([btn("✅ ارسال نهایی برای تصحیح", `final:${cid}:${cm}`)]);
  rows.push([btn("⬅️ تکلیف‌ها", `asg:${cid}`), homeBtn()]);
  await ctx.show(lines.join("\n"), kb(rows));
}

/** af:<courseId>:<cmid>:<index> — an attachment of the assignment description. */
export async function attachment(ctx: Ctx, [cid, cm, i]: string[]): Promise<void> {
  const f = (await findAssignment(ctx, Number(cid), Number(cm)))?.introattachments?.[Number(i)];
  if (f) await sendMoodleFile(ctx, f);
}

// --- submission flow ------------------------------------------------------------------

const uploadKeyboard = () => kb([[btn("✅ ثبت", "upok"), btn("✖️ انصراف", "upcancel")]]);

/** up:<courseId>:<cmid> — start collecting files. */
export async function uploadStart(ctx: Ctx, [cid, cm]: string[]): Promise<void> {
  const assign = await findAssignment(ctx, Number(cid), Number(cm));
  if (!assign) return;
  await ctx.store.set("upload", { courseId: Number(cid), cmid: Number(cm), assignId: assign.id, files: [] });
  await ctx.send(
    `📤 تحویل «${esc(assign.name)}»\n\n` +
    `فایل‌ها را (به‌صورت Document) بفرست؛ حداکثر ${fa(assignConfig(assign, "file", "maxfilesubmissions") ?? "?")} ` +
    `فایل، هر کدام تا ${fmtSize(MAX_RECEIVE_BYTES)}.\n` +
    "⚠️ فایل‌های قبلیِ این تحویل با فایل‌های جدید <b>جایگزین</b> می‌شوند.\n" +
    "بعد از ارسال همه، «ثبت» را بزن.",
    uploadKeyboard());
}

/** A document/photo arrived while an upload session is open. Returns false if there is no session. */
export async function uploadFile(ctx: Ctx, doc: Document | undefined, photos: PhotoSize[] | undefined,
  messageId: number): Promise<boolean> {
  const session = await ctx.store.get("upload");
  if (!session) return false;
  const photo = photos?.at(-1);
  const item = doc
    ? { fileId: doc.file_id, name: doc.file_name ?? "file", size: doc.file_size ?? 0 }
    : photo ? { fileId: photo.file_id, name: `photo_${messageId}.jpg`, size: photo.file_size ?? 0 } : null;
  if (!item) return false;
  if (item.size > MAX_RECEIVE_BYTES) {
    await ctx.send(`❌ ${esc(item.name)} بزرگ‌تر از ${fmtSize(MAX_RECEIVE_BYTES)} است (محدودیت Bot API تلگرام).`);
    return true;
  }
  session.files.push(item);
  await ctx.store.set("upload", session);
  await ctx.send(`📎 ${fa(session.files.length)}. ${esc(item.name)} اضافه شد.`, uploadKeyboard());
  return true;
}

/** upcancel */
export async function uploadCancel(ctx: Ctx): Promise<void> {
  await ctx.store.delete("upload");
  await ctx.send("تحویل لغو شد.", mainMenu());
}

/** upok — download the collected files from Telegram, upload them to Moodle and save the submission. */
export async function uploadCommit(ctx: Ctx): Promise<void> {
  const session = await ctx.store.get("upload");
  if (!session?.files.length) {
    await ctx.answer("هنوز فایلی نفرستادی", true);
    return;
  }
  await ctx.answer();
  const note = await ctx.send("⏳ در حال آپلود به کورسز …");
  const moodle = await ctx.moodle();
  try {
    const payload = await Promise.all(session.files.map(async (f) =>
      ({ name: f.name, data: await ctx.tg.downloadFile(f.fileId) })));
    const itemId = await moodle.uploadDraft(payload);
    await moodle.saveSubmission(session.assignId, itemId);
  } catch (err) {
    if (!(err instanceof MoodleError)) throw err;
    await ctx.tg.editOrSend(ctx.chatId, note.message_id,
      `❌ تحویل انجام نشد: <code>${esc(err.code)}</code>\n${esc(err.message)}`);
    return;
  }
  await ctx.store.delete("upload");
  const { courseId: cid, cmid: cm } = session;
  const status = await moodle.submissionStatus(session.assignId);
  const needsFinal = !!status.lastattempt?.cansubmit;
  await ctx.tg.editOrSend(ctx.chatId, note.message_id,
    `✅ ${fa(session.files.length)} فایل ذخیره شد.\nوضعیت: ${statusLine(status)}` +
    (needsFinal ? "\n\nاین تکلیف «ارسال نهایی» لازم دارد." : ""),
    { reply_markup: kb([
      needsFinal && [btn("✅ ارسال نهایی برای تصحیح", `final:${cid}:${cm}`)],
      [btn("📝 مشاهده‌ی تکلیف", `a:${cid}:${cm}`)],
    ]) });
}

/** final:<courseId>:<cmid> — ask for confirmation. */
export async function finalConfirm(ctx: Ctx, [cid, cm]: string[]): Promise<void> {
  await ctx.send("بعد از ارسال نهایی دیگر نمی‌توانی فایل‌ها را تغییر دهی. مطمئنی؟",
    kb([[btn("بله، ارسال کن", `finalok:${cid}:${cm}`), btn("نه", `a:${cid}:${cm}`)]]));
}

/** finalok:<courseId>:<cmid> — submit for grading. */
export async function finalSubmit(ctx: Ctx, [cid, cm]: string[]): Promise<void> {
  const assign = await findAssignment(ctx, Number(cid), Number(cm));
  if (!assign) return;
  try {
    await (await ctx.moodle()).submitForGrading(assign.id);
    await ctx.show("✅ ارسال نهایی انجام شد.", kb([[btn("📝 مشاهده‌ی تکلیف", `a:${cid}:${cm}`)]]));
  } catch (err) {
    if (!(err instanceof MoodleError)) throw err;
    await ctx.show(`❌ ارسال نهایی انجام نشد: ${esc(err.message || err.code)}`);
  }
}

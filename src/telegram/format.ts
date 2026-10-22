// Text formatting for Persian UI: digits, Jalali dates (Tehran time), sizes, HTML escaping.
// Jalali dates use the runtime's built-in ICU (Intl "persian" calendar) so no date library is needed.

import type { InlineKeyboardButton, InlineKeyboardMarkup } from "@grammyjs/types";

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** Telegram rejects messages longer than 4096 characters. */
const MESSAGE_LIMIT = 4000;

export function fa(value: unknown): string {
  return String(value).replace(/\d/g, (d) => FA_DIGITS[Number(d)]!);
}

export function esc(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Created on first use: building an ICU formatter costs CPU, and most requests never format a date.
let dateFmt: Intl.DateTimeFormat | undefined;

/** Unix seconds → "شنبه ۳ آبان ۱۴۰۵، ۱۴:۳۰" in Tehran time. */
export function fmtTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  dateFmt ??= new Intl.DateTimeFormat("fa-IR-u-ca-persian-nu-arabext", {
    timeZone: "Asia/Tehran", weekday: "long", day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  return dateFmt.format(ts * 1000);
}

/** "⏳ ۲ روز و ۳ ساعت مانده", or "⛔️ مهلت گذشته". */
export function fmtLeft(ts: number | null | undefined, now = Date.now() / 1000): string {
  if (!ts) return "";
  const left = Math.floor(ts - now);
  if (left <= 0) return "⛔️ مهلت گذشته";
  const days = Math.floor(left / 86400);
  const hours = Math.floor((left % 86400) / 3600);
  const minutes = Math.floor((left % 3600) / 60);
  const parts: string[] = [];
  if (days) parts.push(`${days} روز`);
  if (hours) parts.push(`${hours} ساعت`);
  if (!days && minutes) parts.push(`${minutes} دقیقه`);
  return fa(`⏳ ${parts.join(" و ") || "کمتر از یک دقیقه"} مانده`);
}

export function fmtSize(bytes: number | null | undefined): string {
  let size = bytes ?? 0;
  for (const unit of ["B", "KB", "MB"]) {
    if (size < 1024) return fa(unit === "B" ? `${size} ${unit}` : `${size.toFixed(1)} ${unit}`);
    size /= 1024;
  }
  return fa(`${size.toFixed(1)} GB`);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

/** Moodle HTML (descriptions, forum posts) → plain text, cut to `limit` characters. */
export function stripHtml(html: string | null | undefined, limit = 1500): string {
  if (!html) return "";
  const text = html
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) => {
      if (e.startsWith("#x")) return String.fromCodePoint(parseInt(e.slice(2), 16));
      if (e.startsWith("#") && e !== "#39") return String.fromCodePoint(Number(e.slice(1)));
      return ENTITIES[e] ?? m;
    })
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

export function truncate(text: string, limit = MESSAGE_LIMIT): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n…`;
}

// --- keyboards ----------------------------------------------------------------------

export type Button = InlineKeyboardButton;

/** Callback button. Telegram allows at most 64 bytes of callback data. */
export const btn = (text: string, data: string): Button => ({ text: text.slice(0, 60), callback_data: data });

export const urlBtn = (text: string, url: string): Button => ({ text: text.slice(0, 60), url });

/** Build a keyboard, dropping empty rows. */
export const kb = (rows: (Button[] | null | undefined | false)[]): InlineKeyboardMarkup => ({
  inline_keyboard: rows.filter((r): r is Button[] => Array.isArray(r) && r.length > 0),
});

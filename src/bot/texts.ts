// Shared UI texts and keyboards (Persian).

import { btn, esc, kb } from "../telegram/format";

export const MOD_ICONS: Record<string, string> = {
  assign: "📝", resource: "📄", folder: "📁", url: "🔗", forum: "💬", quiz: "❓", page: "📃",
  label: "🏷", book: "📘", choice: "☑️", feedback: "🗳", bigbluebuttonbn: "🎥", lesson: "📖", workshop: "🛠",
};

export const modIcon = (modname: string | undefined) => MOD_ICONS[modname ?? ""] ?? "▫️";

export const SUBMISSION_STATUS: Record<string, string> = {
  new: "❌ تحویل نشده",
  draft: "🟡 پیش‌نویس (ارسال نهایی نشده)",
  submitted: "✅ تحویل داده شده",
  reopened: "🔁 باز شده برای تحویل مجدد",
};

// The site may only accept a QR from the IP that displayed it (Moodle "QR same IP check"). The Worker's IP is
// different, so the local tool is the main path and sending the QR text here is the shortcut.
const LOCAL_LOGIN_STEPS =
  "۱. در کورسز (روی کامپیوتر) به پروفایل برو و «نمایش کد کیوآر» را بزن. هر QR فقط ۱۰ دقیقه و یک بار معتبر است.\n" +
  "۲. QR را با دوربین گوشی (یا Google Lens) اسکن کن و <b>متن لینک</b> را کپی کن.\n" +
  "۳. روی <b>همان کامپیوتر</b> و همان اینترنت، در پوشه‌ی ربات بزن <code>npm run qr-token</code> و وقتی پرسید متن را paste کن.\n" +
  "۴. خطی را که چاپ می‌کند (<code>/settoken …</code>) همین‌جا بفرست.";

export const RELOGIN_TEXT =
  "🔑 اتصال به کورسز برقرار نیست یا توکن منقضی شده.\n\n" +
  "برای ورود:\n" + LOCAL_LOGIN_STEPS + "\n\n" +
  "میان‌بر: متن QR را مستقیم همین‌جا هم می‌توانی بفرستی. اگر کورسز خطای IP داد، از روش بالا استفاده کن.\n" +
  "🔒 متن QR، توکن ربات و خروجی <code>/settoken</code> را برای هیچ‌کس نفرست و جایی منتشر نکن.";

/** Explanation for a failed QR login, by Moodle error code. */
export function qrLoginErrorText(code: string): string {
  switch (code) {
    case "ipmismatch":
      return "❌ کورسز این QR را از سرور ربات قبول نکرد (<code>ipmismatch</code>): " +
        "سایت فقط QRی را می‌پذیرد که از همان IPی تبدیل شود که QR را نشان داده.\n" +
        "همین QR را دوباره نفرست. یک QR تازه بساز و این‌طوری وارد شو:\n\n" + LOCAL_LOGIN_STEPS;
    case "expiredkey":
    case "invalidkey":
      return `❌ این QR دیگر معتبر نیست (<code>${code}</code>): منقضی شده یا قبلاً استفاده شده.\n` +
        "در کورسز یک QR تازه بساز و ظرف چند دقیقه دوباره امتحان کن.";
    case "network":
    case "http":
      return "❌ کورسز الان جواب نمی‌دهد. چند دقیقه بعد با یک QR تازه دوباره امتحان کن.";
    default:
      return `❌ ورود با QR انجام نشد (<code>${esc(code)}</code>).\n\n` + LOCAL_LOGIN_STEPS;
  }
}

export const DELETE_FAILED_TEXT = "⚠️ نتوانستم پیامت را پاک کنم. چون اطلاعات ورود دارد، خودت از چت پاکش کن.";

export const HOME_TEXT = "🎓 <b>پنل کورسز</b>\nیکی را انتخاب کن:";

export const mainMenu = () => kb([
  [btn("📚 درس‌های این ترم", "terms:cur")],
  [btn("⏰ ددلاین‌ها", "deadlines"), btn("🔔 اعلان‌های کورسز", "notifs")],
  [btn("🗂 همه‌ی درس‌ها", "terms:all"), btn("⚙️ وضعیت", "status")],
]);

export const homeBtn = () => btn("🏠 منو", "home");

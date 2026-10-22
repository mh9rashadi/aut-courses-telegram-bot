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
// different, so logging in through the installer on the user's computer is the main path; sending the QR text
// here is only a shortcut.
const LOCAL_LOGIN_STEPS =
  "۱. روی کامپیوتر، در پوشه‌ی ربات فایل <b>install.cmd</b> را باز کن (در مک/لینوکس: <code>npm run installer</code>).\n" +
  "۲. در صفحه‌ای که باز می‌شود، مرحله‌ی «ورود به کورسز» را انجام بده: از QR پروفایل کورسز عکس بگیر و همان‌جا Ctrl+V بزن.\n" +
  "هر QR فقط ۱۰ دقیقه و یک بار معتبر است.";

export const RELOGIN_TEXT =
  "🔑 اتصال به کورسز برقرار نیست یا منقضی شده.\n\n" +
  "برای ورود:\n" + LOCAL_LOGIN_STEPS + "\n\n" +
  "میان‌بر: متن QR را مستقیم همین‌جا هم می‌توانی بفرستی. اگر کورسز خطای IP داد، از روش بالا استفاده کن.\n" +
  "🔒 متن QR، عکس QR و توکن ربات را برای هیچ‌کس نفرست و جایی منتشر نکن.";

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

// Shared UI texts and keyboards (Persian).

import { btn, kb } from "../telegram/format";

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

export const RELOGIN_TEXT =
  "🔑 اتصال به کورسز برقرار نیست یا توکن منقضی شده.\n\n" +
  "برای ورود دوباره:\n" +
  "۱. در کورسز (کامپیوتر) به پروفایل برو و «نمایش کد کیوآر» را بزن.\n" +
  "۲. QR را با دوربین گوشی (یا Google Lens) اسکن کن و <b>متن لینک</b> را کپی کن.\n" +
  "۳. همان متن (<code>moodlemobile://…qrlogin=…</code>) را همین‌جا بفرست.\n\n" +
  "اگر نشد: <code>npm run qr-token</code> را روی لپ‌تاپ اجرا کن و خروجی <code>/settoken …</code> را بفرست.";

export const HOME_TEXT = "🎓 <b>پنل کورسز</b>\nیکی را انتخاب کن:";

export const mainMenu = () => kb([
  [btn("📚 درس‌های این ترم", "terms:cur")],
  [btn("⏰ ددلاین‌ها", "deadlines"), btn("🔔 اعلان‌های کورسز", "notifs")],
  [btn("🗂 همه‌ی درس‌ها", "terms:all"), btn("⚙️ وضعیت", "status")],
]);

export const homeBtn = () => btn("🏠 منو", "home");

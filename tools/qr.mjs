// Pure helpers for tools/qr-token.mjs (kept separate so the tests can import them without network calls).
// User-facing messages are Persian.

export const MOODLE = "https://courses.aut.ac.ir";

/**
 * Check the text read from the profile-page QR: moodlemobile://https://courses.aut.ac.ir?qrlogin=KEY&userid=ID
 * Returns { key, userid } or { error } with one of: empty, placeholder, site, format.
 */
export function parseQrInput(raw) {
  const text = String(raw ?? "").trim().replace(/^["']|["']$/g, "");
  if (!text) return { error: "empty" };
  if (/YOUR_|KEY&|=ID\b|[<>…]/.test(text)) return { error: "placeholder" };
  if (!text.includes("courses.aut.ac.ir")) return { error: "site" };
  const key = /[?&]qrlogin=([A-Za-z0-9]+)(?:&|$)/.exec(text)?.[1];
  const userid = /[?&]userid=(\d+)(?:&|$)/.exec(text)?.[1];
  if (!key || !userid) return { error: "format" };
  return { key, userid: Number(userid) };
}

const INPUT_HELP = {
  empty: "متنی وارد نشد. متن QR را paste کن و Enter بزن.",
  placeholder: "این متن نمونه‌ی راهنماست، نه QR خودت. متنی را paste کن که دوربین گوشی از QR خودت خوانده.",
  site: "این QR ورود کورسز امیرکبیر (courses.aut.ac.ir) نیست.",
  format: "متن QR ناقص است: باید هم qrlogin=… و هم userid=<عدد> داشته باشد. دوباره کامل کپی کن.",
};

export const inputHelp = (error) => INPUT_HELP[error] ?? INPUT_HELP.format;

// A QR shown by a profile page whose session has already expired is refused too, and Moodle may report that as
// ipmismatch or invalidkey. It is the most common cause in practice, so every QR error starts with it.
const FRESH_QR =
  "صفحه‌ی پروفایل کورسز را رفرش کن (F5). اگر صفحه‌ی ورود آمد، یعنی از حسابت خارج شده بودی: دوباره وارد شو.\n" +
  "بعد «نمایش کد کیوآر» را بزن و از QR تازه عکس بگیر.";

/** Explanation for a Moodle (or network) error code from tool_mobile_get_tokens_for_qr_login. */
export function qrErrorHelp(code) {
  switch (code) {
    case "expiredkey":
    case "invalidkey":
    case "ipmismatch":
      return "کورسز این QR را قبول نکرد. معمولاً یکی از این‌هاست:\n" +
        "• از حساب کورسز خارج شده‌ای (سشن منقضی شده)، ولی صفحه‌ی قدیمی هنوز QR را نشان می‌دهد.\n" +
        "• QR قدیمی است: هر QR فقط ۱۰ دقیقه و یک بار معتبر است.\n" +
        (code === "ipmismatch"
          ? "• مرورگر و این برنامه از دو اینترنت مختلف رد می‌شوند (مثلاً VPN فقط روی مرورگر روشن است).\n" : "") +
        "\nچه کار کنی: " + FRESH_QR;
    case "network":
      return "به courses.aut.ac.ir وصل نشدم. اینترنت/VPN را چک کن و با یک QR تازه دوباره امتحان کن.";
    case "badresponse":
      return "کورسز جواب عجیبی داد (شاید سایت قطع است یا در حال تعمیر). کمی بعد دوباره امتحان کن.";
    default:
      return "کورسز QR را قبول نکرد.\n\nچه کار کنی: " + FRESH_QR;
  }
}

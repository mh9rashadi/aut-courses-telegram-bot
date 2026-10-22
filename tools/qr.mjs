// Pure helpers for tools/qr-token.mjs (kept separate so the tests can import them without network calls).

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
  empty: "No QR text given.",
  placeholder: "This looks like the example from the docs, not your own QR. Paste the text your phone read from the QR.",
  site: "This is not a courses.aut.ac.ir login QR.",
  format: "The QR text is incomplete: it must contain both qrlogin=… and userid=<number>. Copy the whole text again.",
};

export const inputHelp = (error) => INPUT_HELP[error] ?? INPUT_HELP.format;

/** Explanation for a Moodle (or network) error code from tool_mobile_get_tokens_for_qr_login. */
export function qrErrorHelp(code) {
  switch (code) {
    case "expiredkey":
    case "invalidkey":
      return "This QR is no longer valid (it expired after 10 minutes or was already used). " +
        "Show a new QR on the courses profile page and run this again right away.";
    case "ipmismatch":
      return "The site wants the QR to be redeemed from the same internet connection that displayed it. " +
        "Make sure the browser showing the QR and this terminal use the same network (same VPN on or off), " +
        "then try again with a new QR. Don't try to work around this check.";
    case "network":
      return "Could not reach courses.aut.ac.ir. Check your internet/VPN and try again with a new QR.";
    case "badresponse":
      return "courses.aut.ac.ir sent an unexpected answer (site down or under maintenance?). Try again later.";
    default:
      return "The site refused the QR. Try once more with a new QR; if it keeps failing, see docs/OPERATIONS.md.";
  }
}

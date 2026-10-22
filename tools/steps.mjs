// Install steps shared by the browser installer (tools/installer/) and the terminal version (tools/setup.mjs).
// Every step is safe to repeat: secrets in .dev.vars are kept, the database is found by name, deploy overwrites.
// Messages returned to the user are Persian.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, TelegramUnreachable, deployErrorHelp, readDevVars, registerWebhook, telegram, writeDevVars }
  from "./lib.mjs";
import { MOODLE, inputHelp, parseQrInput, qrErrorHelp } from "./qr.mjs";

export const DB_NAME = "aut-courses-bot";
export const WORKER_NAME =
  /"name"\s*:\s*"([^"]+)"/.exec(readFileSync(join(ROOT, "wrangler.jsonc"), "utf8"))?.[1] ?? "aut-courses-bot";
const WRANGLER = join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");

/** A failure the user can act on; the message is Persian and says what to do. */
export class StepError extends Error {}

/**
 * Run wrangler (the project's own copy, no shell) in the project root, where it finds wrangler.jsonc and .dev.vars.
 * Resolves with { code, out } where out = stdout + stderr.
 */
function wrangler(args) {
  if (!existsSync(WRANGLER)) {
    throw new StepError("پوشه‌ی node_modules کامل نیست. اول npm install را اجرا کن (install.cmd خودش این کار را می‌کند).");
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [WRANGLER, ...args],
      { cwd: ROOT, env: { ...process.env, FORCE_COLOR: "0" } });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    child.on("error", (err) => resolve({ code: -1, out: String(err) }));
    child.on("close", (code) => resolve({ code, out }));
  });
}

// wrangler remembers the account per project here. After logging in with another account it keeps using the old
// one and every call fails with "Authentication error [code: 10000]".
const ACCOUNT_CACHE = join(ROOT, "node_modules", ".cache", "wrangler", "wrangler-account.json");
const forgetAccount = () => rmSync(ACCOUNT_CACHE, { force: true });

async function wranglerOk(args, fallback) {
  let res = await wrangler(args);
  if (res.code !== 0 && /code: 10000/.test(res.out) && existsSync(ACCOUNT_CACHE)) {
    forgetAccount();
    res = await wrangler(args);
  }
  if (res.code !== 0) throw new StepError(deployErrorHelp(res.out) ?? fallback);
  return res.out;
}

function parseJson(text) {
  try {
    return JSON.parse(text.slice(text.search(/[[{]/)));
  } catch {
    return null;
  }
}

// --- 1. Cloudflare ----------------------------------------------------------------------------------------------

/** { loggedIn, email, subdomain }; subdomain is null when unknown, "" when the account has none. */
export async function cloudflareStatus() {
  const who = parseJson((await wrangler(["whoami", "--json"])).out);
  if (!who?.loggedIn) return { loggedIn: false };
  return { loggedIn: true, email: who.email, subdomain: await workersDevSubdomain(who.accounts ?? []) };
}

/**
 * The Worker is published on <name>.<account-subdomain>.workers.dev. A new Cloudflare account may have no subdomain
 * yet, and wrangler can't ask for one when run from here, so check before creating anything.
 */
async function workersDevSubdomain(accounts) {
  if (accounts.length !== 1) return null; // several accounts: wrangler decides at deploy
  try {
    const { token } = parseJson((await wrangler(["auth", "token", "--json"])).out) ?? {};
    const resp = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accounts[0].id}/workers/subdomain`,
      { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    const data = await resp.json();
    if (data.success && data.result?.subdomain) return data.result.subdomain;
    if (resp.status === 404 || data.success) return "";
  } catch {
    // older wrangler, network trouble, …: deploy reports the problem itself
  }
  return null;
}

/** Opens the browser for Cloudflare's "Allow" page and waits until the user finishes (or wrangler times out). */
export async function cloudflareLogin() {
  forgetAccount();
  await wranglerOk(["login"], "ورود به Cloudflare انجام نشد. دوباره امتحان کن و در مرورگر Allow را بزن.");
}

export async function cloudflareLogout() {
  await wrangler(["logout"]);
  forgetAccount();
}

// --- 2. Telegram bot ------------------------------------------------------------------------------------------

/**
 * Check the bot token and Telegram id and save them (plus generated secrets) to .dev.vars.
 * Returns { bot } when Telegram confirmed the token, or { unverified: true } when Telegram can't be reached from
 * this computer (the Worker checks it later from Cloudflare).
 */
export async function saveBotSettings(token, ownerId) {
  token = String(token ?? "").trim();
  ownerId = String(ownerId ?? "").trim();
  if (!/^\d+:[\w-]{30,}$/.test(token)) {
    throw new StepError("این شبیه توکن ربات نیست. توکن شکلی مثل 123456789:AAH… دارد؛ دوباره از @BotFather کپی کن.");
  }
  if (!/^\d{4,}$/.test(ownerId)) {
    throw new StepError("آیدی عددی تلگرام فقط از رقم تشکیل شده (مثلاً 123456789). از @userinfobot بگیرش.");
  }
  let result;
  try {
    const me = await telegram(token, "getMe");
    result = { bot: me.username };
  } catch (err) {
    if (!(err instanceof TelegramUnreachable)) {
      throw new StepError(`تلگرام این توکن را قبول نکرد (${err.message.replace(/^Telegram getMe: /, "")}). ` +
        "دوباره از @BotFather کپی کن؛ اگر /revoke زده‌ای، توکن جدید را بده.");
    }
    result = { unverified: true };
  }
  const vars = readDevVars();
  vars.BOT_TOKEN = token;
  vars.OWNER_ID = ownerId;
  vars.WEBHOOK_SECRET ||= randomBytes(32).toString("base64url");
  vars.TOKEN_KEY ||= randomBytes(32).toString("base64"); // never replaced: it decrypts the stored login
  writeDevVars(vars);
  return result;
}

// --- 3. Database + deploy -------------------------------------------------------------------------------------

export async function setupDatabase(log = () => {}) {
  const dbs = parseJson(await wranglerOk(["d1", "list", "--json"], "فهرست دیتابیس‌های Cloudflare گرفته نشد."));
  if (Array.isArray(dbs) && dbs.some((db) => db.name === DB_NAME)) {
    log("دیتابیس از قبل هست؛ همان استفاده می‌شود.");
  } else {
    log("ساختن دیتابیس…");
    // wrangler.jsonc already has the binding (found by name), so don't let `d1 create` edit the config.
    await wranglerOk(["d1", "create", DB_NAME, "--no-update-config"], "ساختن دیتابیس انجام نشد.");
  }
  log("ساختن جدول‌ها…");
  await wranglerOk(["d1", "migrations", "apply", DB_NAME, "--remote"], "ساختن جدول‌های دیتابیس انجام نشد.");
}

/** Upload the Worker with the secrets from .dev.vars. Returns its https://….workers.dev URL. */
export async function deployWorker(log = () => {}) {
  if (!readDevVars().BOT_TOKEN) throw new StepError("اول مرحله‌ی ربات تلگرام را کامل کن.");
  log("فرستادن کد ربات به Cloudflare (حدود ۳۰ ثانیه)…");
  const out = await wranglerOk(["deploy", "--secrets-file", ".dev.vars"], "بالا آوردن ربات روی Cloudflare انجام نشد.");
  const url = /https:\/\/[\w.-]+\.workers\.dev/.exec(out)?.[0];
  if (!url) {
    throw new StepError("ربات بالا آمد ولی آدرسش را پیدا نکردم. در داشبورد Cloudflare ← Workers & Pages ← " +
      `${WORKER_NAME} گزینه‌ی workers.dev را روشن کن و دوباره امتحان کن.`);
  }
  // The Worker reads this to connect itself to Telegram from its cron (setup.ts).
  await kvSet({ worker_url: url });
  return url;
}

// --- 4. Telegram webhook --------------------------------------------------------------------------------------

/**
 * Connect the bot to the Worker. Tries, in order: from this computer straight to Telegram, through the Worker's
 * /setup hook, and finally what the Worker's own cron run reported. Returns
 *   { ok: true, bot }                        connected
 *   { ok: false, tokenRefused: true, error } Telegram refused the bot token: ask for it again
 *   { ok: false, pending: true }             not yet: new workers.dev name not resolvable / Telegram unreachable
 */
export async function connectTelegram(url) {
  const { BOT_TOKEN, WEBHOOK_SECRET } = readDevVars();
  const refused = (error) => ({ ok: false, tokenRefused: true, error });

  try {
    await registerWebhook(BOT_TOKEN, WEBHOOK_SECRET, url);
    const me = await telegram(BOT_TOKEN, "getMe");
    await kvSet({ webhook_url: `${url}/telegram` });
    return { ok: true, bot: me.username };
  } catch (err) {
    if (/Unauthorized|Not Found/i.test(err.message)) return refused(err.message);
    // Unreachable from here, or Telegram can't resolve the new hostname yet: try the other ways.
  }

  try {
    const resp = await fetch(`${url}/setup`, {
      method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": WEBHOOK_SECRET },
      signal: AbortSignal.timeout(30_000),
    });
    const status = await resp.json();
    if (status?.ok) return { ok: true, bot: status.bot };
    if (/Unauthorized|Not Found/i.test(status?.error ?? "")) return refused(status.error);
  } catch {
    // workers.dev not reachable from here yet (or filtered)
  }

  const { setup_status: status, webhook_url } = await kvGet("setup_status", "webhook_url");
  if (status?.ok && webhook_url === `${url}/telegram`) return { ok: true, bot: status.bot };
  if (status && !status.ok && /Unauthorized|Not Found/i.test(status.error ?? "")) return refused(status.error);
  return { ok: false, pending: true };
}

// --- 5. Moodle login ------------------------------------------------------------------------------------------

/**
 * Redeem the profile-page QR text from this computer (same IP as the browser that showed it), check the token,
 * and store it encrypted in the bot's database. Returns { name }.
 */
export async function loginWithQr(qrText) {
  const qr = parseQrInput(qrText);
  if (qr.error) throw new StepError(inputHelp(qr.error));
  const token = await redeemQr(qr);
  const info = await moodleCall(token, "core_webservice_get_site_info");
  await saveMoodleToken(token, info.userid);
  return { name: info.fullname };
}

export async function redeemQr({ key, userid }) {
  let res;
  try {
    const resp = await fetch(`${MOODLE}/lib/ajax/service-nologin.php?info=tool_mobile_get_tokens_for_qr_login`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "MoodleMobile 4.5.0" },
      body: JSON.stringify([{ index: 0, methodname: "tool_mobile_get_tokens_for_qr_login",
        args: { qrloginkey: key, userid } }]),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) throw new StepError(`HTTP ${resp.status}. ${qrErrorHelp("badresponse")}`);
    [res] = await resp.json().catch(() => [null]);
  } catch (err) {
    if (err instanceof StepError) throw err;
    throw new StepError(qrErrorHelp("network"));
  }
  if (!res) throw new StepError(qrErrorHelp("badresponse"));
  if (res.error || !res.data?.token) {
    // Only the error code is shown: the raw response isn't needed and must not end up in shared logs.
    const code = String(res.exception?.errorcode ?? "unknown");
    throw new StepError(`ورود انجام نشد (کد خطا: ${code}).\n${qrErrorHelp(code)}`);
  }
  return res.data.token;
}

async function moodleCall(token, fn) {
  let data;
  try {
    const resp = await fetch(`${MOODLE}/webservice/rest/server.php?moodlewsrestformat=json`, {
      method: "POST",
      body: new URLSearchParams({ wstoken: token, wsfunction: fn }),
      signal: AbortSignal.timeout(30_000),
    });
    data = await resp.json();
  } catch {
    throw new StepError(qrErrorHelp("network"));
  }
  if (data?.exception) throw new StepError(`کورسز توکن را قبول نکرد (${data.errorcode}). با یک QR تازه دوباره امتحان کن.`);
  return data;
}

/** Same format as src/crypto.ts ("v1.<iv>.<ciphertext>", AES-GCM), so the Worker can decrypt it. */
export async function encryptToken(plain, keyB64) {
  const key = await crypto.subtle.importKey("raw", Buffer.from(keyB64, "base64"), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  return `v1.${Buffer.from(iv).toString("base64")}.${Buffer.from(data).toString("base64")}`;
}

async function saveMoodleToken(token, userid) {
  const { TOKEN_KEY } = readDevVars();
  if (!TOKEN_KEY) throw new StepError("فایل .dev.vars پیدا نشد یا کامل نیست. اول مرحله‌های نصب را کامل کن.");
  await kvSet({ moodle_token: await encryptToken(token, TOKEN_KEY), moodle_userid: userid, token_alerted: false });
}

// --- D1 kv table (same layout as src/store.ts) -----------------------------------------------------------------

const sqlText = (s) => `'${String(s).replaceAll("'", "''")}'`;

/** SQL that upserts kv rows; values are stored as JSON, like Store.set. */
export function kvUpsertSql(values, now = Math.floor(Date.now() / 1000)) {
  return Object.entries(values).map(([k, v]) =>
    `INSERT INTO kv (key, value, updated_at) VALUES (${sqlText(k)}, ${sqlText(JSON.stringify(v))}, ${now}) ` +
    `ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`).join("\n");
}

async function kvSet(values) {
  // Through a file, not --command: keeps values out of the process list and avoids quoting problems.
  const file = join(tmpdir(), `aut-bot-${randomBytes(6).toString("hex")}.sql`);
  writeFileSync(file, kvUpsertSql(values), { mode: 0o600 });
  try {
    await wranglerOk(["d1", "execute", DB_NAME, "--remote", "--yes", "--file", file], "نوشتن در دیتابیس ربات انجام نشد.");
  } finally {
    rmSync(file, { force: true });
  }
}

async function kvGet(...keys) {
  const sql = `SELECT key, value FROM kv WHERE key IN (${keys.map(sqlText).join(",")})`;
  const out = await wranglerOk(["d1", "execute", DB_NAME, "--remote", "--json", "--command", sql],
    "خواندن از دیتابیس ربات انجام نشد.");
  const rows = parseJson(out)?.[0]?.results ?? [];
  return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
}

// Helpers shared by the tools/ scripts (Node.js, run on your own computer). User-facing messages are Persian.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Project root (where wrangler.jsonc is), so the tools work from any current directory. */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DEV_VARS = join(ROOT, ".dev.vars");

/** An actionable explanation for known wrangler failures (from its output), or null if unknown. */
export function deployErrorHelp(output) {
  if (/register a workers\.dev subdomain/i.test(output)) {
    return "اکانت Cloudflare تو هنوز زیردامنه‌ی workers.dev ندارد (برای هر اکانت فقط یک بار لازم است).\n" +
      "   این صفحه را باز کن و یک اسم برای زیردامنه انتخاب کن: https://dash.cloudflare.com/?to=/:account/workers-and-pages\n" +
      "   (یا Workers & Pages ← Settings ← Subdomain). یک دقیقه صبر کن و دوباره بزن npm run setup.";
  }
  if (/timed out waiting for authorization/i.test(output)) {
    return "ورود به Cloudflare در مرورگر تمام نشد (زمانش گذشت). دوباره بزن npm run setup و این بار در مرورگر " +
      "وارد شو و Allow را بزن.";
  }
  if (/not authenticated|authentication error|\[code: 10000\]|invalid access token/i.test(output)) {
    return "ورود به Cloudflare انجام نشده یا منقضی شده. بزن npx wrangler login و بعد دوباره npm run setup.";
  }
  if (/more than one account|multiple accounts/i.test(output)) {
    return "چند اکانت Cloudflare داری. متغیر CLOUDFLARE_ACCOUNT_ID را روی همان اکانتی بگذار که می‌خواهی، و دوباره setup بزن.";
  }
  return null;
}

/** Read KEY=value lines from .dev.vars (git-ignored local copy of the Worker secrets). */
export function readDevVars() {
  if (!existsSync(DEV_VARS)) return {};
  return Object.fromEntries(readFileSync(DEV_VARS, "utf8").split(/\r?\n/)
    .map((line) => /^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$/.exec(line))
    .filter(Boolean).map((m) => [m[1], m[2]]));
}

export function writeDevVars(vars) {
  const body = Object.entries(vars).map(([k, v]) => `${k}=${v}`).join("\n");
  writeFileSync(DEV_VARS,
    "# Local copy of the Worker secrets. Git-ignored: never commit or share this file.\n" + body + "\n");
}

/** api.telegram.org did not answer (often blocked by the network), as opposed to Telegram refusing the call. */
export class TelegramUnreachable extends Error {}

export async function telegram(token, method, params = {}) {
  let data;
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params),
      signal: AbortSignal.timeout(20_000),
    });
    data = await resp.json();
  } catch {
    throw new TelegramUnreachable("به سرور تلگرام (api.telegram.org) وصل نشدم. روی اینترنت ایران فیلتر است: " +
      "VPN را روشن کن و دوباره امتحان کن.");
  }
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description}`);
  return data.result;
}

/** Point the bot at the Worker and set the command menu. */
export async function registerWebhook(token, secret, workerUrl) {
  await telegram(token, "setWebhook", {
    url: `${workerUrl.replace(/\/+$/, "")}/telegram`,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    max_connections: 1, // one update at a time: simple, consistent state for a single user
  });
  await telegram(token, "setMyCommands", {
    commands: [
      { command: "menu", description: "پنل کورسز" },
      { command: "status", description: "وضعیت اتصال و اعلان‌ها" },
      { command: "settoken", description: "ثبت توکن کورسز" },
      { command: "logout", description: "حذف توکن از ربات" },
    ],
  });
}

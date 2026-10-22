// Helpers shared by the tools/ scripts (Node.js, run on your own computer).

import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const DEV_VARS = ".dev.vars";

/** An actionable explanation for known wrangler failures (from its output), or null if unknown. */
export function deployErrorHelp(output) {
  if (/register a workers\.dev subdomain/i.test(output)) {
    return "Your Cloudflare account has no workers.dev subdomain yet (needed once per account).\n" +
      "   Open https://dash.cloudflare.com/?to=/:account/workers-and-pages , pick a subdomain when asked\n" +
      "   (or Workers & Pages → Settings → Subdomain), wait a minute, then run `npm run setup` again.";
  }
  if (/not authenticated|authentication error|\[code: 10000\]|invalid access token/i.test(output)) {
    return "Cloudflare login is missing or expired. Run `npx wrangler login`, then `npm run setup` again.";
  }
  if (/more than one account|multiple accounts/i.test(output)) {
    return "You have several Cloudflare accounts. Set CLOUDFLARE_ACCOUNT_ID to the one to use, then run setup again.";
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

export async function telegram(token, method, params = {}) {
  const resp = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params),
  });
  const data = await resp.json();
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

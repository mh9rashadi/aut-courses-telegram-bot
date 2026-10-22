// The Worker connects its own bot to Telegram (setWebhook + command menu).
// The installer can't always do it from the user's computer: api.telegram.org is blocked on many networks
// (e.g. in Iran), and a brand-new workers.dev hostname takes minutes to resolve. Cloudflare reaches Telegram
// fine, so the Worker does it: on POST /setup (called by the installer) and on every cron run until it worked.

import type { User } from "@grammyjs/types";
import { Store } from "./store";
import { Telegram } from "./telegram/api";

export const SETUP_PATH = "/setup";
export const WEBHOOK_PATH = "/telegram";

/** Keep in sync with registerWebhook in tools/lib.mjs (used when the computer can reach Telegram itself). */
export const COMMANDS = [
  { command: "menu", description: "پنل کورسز" },
  { command: "status", description: "وضعیت اتصال و اعلان‌ها" },
  { command: "settoken", description: "ثبت توکن کورسز" },
  { command: "logout", description: "حذف توکن از ربات" },
];

export interface SetupStatus {
  ok: boolean;
  bot?: string; // @username
  error?: string;
  at: number;
}

/**
 * Point Telegram at `origin` + /telegram unless that is already done. `origin` comes from the /setup request,
 * or from kv.worker_url (written by the installer) when called from cron. Never throws: the outcome is stored
 * in kv.setup_status, which the installer reads.
 */
export async function ensureWebhook(env: Env, store: Store, origin?: string): Promise<SetupStatus | null> {
  const { worker_url, webhook_url } = await store.getMany("worker_url", "webhook_url");
  const target = origin ?? worker_url;
  if (!target) return null;
  const url = `${target.replace(/\/+$/, "")}${WEBHOOK_PATH}`;
  if (!origin && webhook_url === url) return null;

  const tg = new Telegram(env.BOT_TOKEN);
  let status: SetupStatus;
  try {
    const me = await tg.call<User>("getMe");
    await tg.call("setWebhook", {
      url, secret_token: env.WEBHOOK_SECRET, allowed_updates: ["message", "callback_query"],
      max_connections: 1, // one update at a time: simple, consistent state for a single user
    });
    await tg.call("setMyCommands", { commands: COMMANDS });
    await store.set("webhook_url", url);
    status = { ok: true, bot: me.username, at: Math.floor(Date.now() / 1000) };
  } catch (err) {
    status = { ok: false, error: err instanceof Error ? err.message : String(err), at: Math.floor(Date.now() / 1000) };
  }
  await store.set("setup_status", status);
  return status;
}

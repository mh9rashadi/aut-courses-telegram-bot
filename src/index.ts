// Worker entry point.
//   fetch     — Telegram webhook (POST /telegram). Every other path returns 404.
//   scheduled — Cron Trigger (wrangler.jsonc) → background checks in poller/.

import type { Update } from "@grammyjs/types";
import { handleUpdate } from "./bot/router";
import { runPoller } from "./poller";

export const WEBHOOK_PATH = "/telegram";

/** Constant-time string comparison, so the secret can't be guessed from response timing. */
function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  return crypto.subtle.timingSafeEqual(x, y);
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== WEBHOOK_PATH) return new Response("Not found", { status: 404 });

    // Telegram sends the secret given to setWebhook in this header; anything else is not Telegram.
    if (!safeEqual(request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "", env.WEBHOOK_SECRET)) {
      return new Response("Forbidden", { status: 403 });
    }

    const update = (await request.json()) as Update;
    try {
      // Processed inline (not waitUntil): file transfers can take longer than waitUntil's 30 s budget.
      // The webhook is registered with max_connections=1, so updates arrive one at a time.
      await handleUpdate(update, env);
    } catch (err) {
      console.error("update failed", update.update_id, err);
    }
    // Always 200: a non-2xx makes Telegram retry the same update over and over.
    return new Response("ok");
  },

  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(runPoller(env));
  },
} satisfies ExportedHandler<Env>;

// Worker entry point.
//   fetch     — Telegram webhook (POST /telegram) and installer hook (POST /setup). Every other path returns 404.
//   scheduled — Cron Trigger (wrangler.jsonc) → finish setup if needed (setup.ts), then background checks in poller/.

import type { Update } from "@grammyjs/types";
import { handleUpdate } from "./bot/router";
import { safeEqual } from "./crypto";
import { runPoller } from "./poller";
import { SETUP_PATH, WEBHOOK_PATH, ensureWebhook } from "./setup";
import { Store } from "./store";

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || (url.pathname !== WEBHOOK_PATH && url.pathname !== SETUP_PATH)) {
      return new Response("Not found", { status: 404 });
    }

    // Telegram sends the secret given to setWebhook in this header; the installer sends the same secret.
    // Anything else is neither.
    if (!safeEqual(request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "", env.WEBHOOK_SECRET)) {
      return new Response("Forbidden", { status: 403 });
    }

    if (url.pathname === SETUP_PATH) {
      const status = await ensureWebhook(env, new Store(env.DB, env.TOKEN_KEY), url.origin);
      return Response.json(status);
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
    ctx.waitUntil((async () => {
      await ensureWebhook(env, new Store(env.DB, env.TOKEN_KEY));
      await runPoller(env);
    })());
  },
} satisfies ExportedHandler<Env>;

import { afterEach, describe, expect, it, vi } from "vitest";
import { decrypt } from "../src/crypto";
import { ensureWebhook } from "../src/setup";
import type { Store } from "../src/store";
import { encryptToken, kvUpsertSql } from "../tools/steps.mjs";

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

describe("installer → Worker data", () => {
  it("encrypts the Moodle token in the format the Worker decrypts", async () => {
    const sealed = await encryptToken("0123456789abcdef0123456789abcdef", KEY);
    expect(await decrypt(sealed, KEY)).toBe("0123456789abcdef0123456789abcdef");
  });

  it("writes kv rows as JSON and escapes quotes", () => {
    const sql = kvUpsertSql({ worker_url: "https://x.workers.dev", note: "it's" }, 100);
    expect(sql).toContain(`VALUES ('worker_url', '"https://x.workers.dev"', 100)`);
    expect(sql).toContain(`'"it''s"'`);
  });
});

/** In-memory stand-in for the two Store methods ensureWebhook uses. */
function fakeStore(initial: Record<string, unknown> = {}) {
  const kv: Record<string, unknown> = { ...initial };
  return {
    kv,
    store: {
      getMany: async (...keys: string[]) => Object.fromEntries(keys.filter((k) => k in kv).map((k) => [k, kv[k]])),
      set: async (k: string, v: unknown) => { kv[k] = v; },
    } as unknown as Store,
  };
}

const env = { BOT_TOKEN: "1:x", WEBHOOK_SECRET: "s" } as Env;

function telegramReplies(handler: (method: string) => object) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    const method = url.split("/").pop()!;
    calls.push(method);
    return Response.json(handler(method));
  });
  return calls;
}

describe("Worker connects itself to Telegram", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does nothing until the installer stored the Worker URL", async () => {
    const { store } = fakeStore();
    expect(await ensureWebhook(env, store)).toBeNull();
  });

  it("registers the webhook once from cron and remembers it", async () => {
    const calls = telegramReplies((m) => ({ ok: true, result: m === "getMe" ? { username: "my_bot" } : true }));
    const { store, kv } = fakeStore({ worker_url: "https://b.x.workers.dev" });
    expect(await ensureWebhook(env, store)).toMatchObject({ ok: true, bot: "my_bot" });
    expect(calls).toEqual(["getMe", "setWebhook", "setMyCommands"]);
    expect(kv.webhook_url).toBe("https://b.x.workers.dev/telegram");
    expect(await ensureWebhook(env, store)).toBeNull(); // already done
  });

  it("stores Telegram's refusal for the installer to show", async () => {
    telegramReplies(() => ({ ok: false, error_code: 401, description: "Unauthorized" }));
    const { store, kv } = fakeStore({ worker_url: "https://b.x.workers.dev" });
    expect(await ensureWebhook(env, store)).toMatchObject({ ok: false });
    expect(String((kv.setup_status as { error: string }).error)).toContain("Unauthorized");
    expect(kv.webhook_url).toBeUndefined();
  });
});

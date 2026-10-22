import { describe, expect, it } from "vitest";
import { claimOwner, ownerId } from "../src/bot/owner";
import { sha256Hex } from "../src/crypto";
import type { Store } from "../src/store";

// Workers-only API (the tests run in Node).
const subtle = crypto.subtle as unknown as { timingSafeEqual?: (a: Uint8Array, b: Uint8Array) => boolean };
subtle.timingSafeEqual ??= (a: Uint8Array, b: Uint8Array) => a.every((v, i) => v === b[i]);

/** In-memory stand-in for the Store methods owner.ts uses. */
function fakeStore(initial: Record<string, unknown> = {}) {
  const kv: Record<string, unknown> = { ...initial };
  const store = {
    get: async (k: string) => kv[k] ?? null,
    getMany: async (...keys: string[]) => Object.fromEntries(keys.filter((k) => k in kv).map((k) => [k, kv[k]])),
    set: async (k: string, v: unknown) => { kv[k] = v; },
    delete: async (...keys: string[]) => keys.forEach((k) => delete kv[k]),
  } as unknown as Store;
  return { kv, store };
}

describe("bot owner", () => {
  it("prefers the OWNER_ID secret of older installs", async () => {
    const { store } = fakeStore({ owner_id: 2 });
    expect(await ownerId({ OWNER_ID: "1" } as Env, store)).toBe(1);
    expect(await ownerId({} as Env, store)).toBe(2);
    expect(await ownerId({} as Env, fakeStore().store)).toBeNull();
  });

  it("lets the holder of the installer's code claim the bot once", async () => {
    const { kv, store } = fakeStore({ claim_code: await sha256Hex("secret-code") });
    expect(await claimOwner(store, "wrong-code", 7)).toBe(false);
    expect(kv.owner_id).toBeUndefined();

    expect(await claimOwner(store, "secret-code", 42)).toBe(true);
    expect(kv.owner_id).toBe(42);
    expect(kv.claim_code).toBeUndefined();

    expect(await claimOwner(store, "secret-code", 7)).toBe(false); // code used up, owner kept
    expect(kv.owner_id).toBe(42);
  });

  it("can't be claimed without a code from the installer", async () => {
    const { kv, store } = fakeStore();
    expect(await claimOwner(store, "anything", 7)).toBe(false);
    expect(kv.owner_id).toBeUndefined();
  });

  it("hashes like the installer (Node createHash)", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

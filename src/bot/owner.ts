// Who owns the bot. Only the owner can use it: the bot works with the owner's courses account.
//
// Older installs (and manual setups) set the OWNER_ID secret. The installer instead lets the owner claim the bot:
// it stores the SHA-256 of a random code in kv.claim_code and shows a t.me/<bot>?start=<code> link. Whoever sends
// that "/start <code>" first, while the bot has no owner, becomes the owner; the code is then deleted.
// Updates arrive one at a time (max_connections=1), so two claims can't race.

import { safeEqual, sha256Hex } from "../crypto";
import type { Store } from "../store";

export async function ownerId(env: Env, store: Store): Promise<number | null> {
  if (env.OWNER_ID) return Number(env.OWNER_ID);
  return store.get("owner_id");
}

/** Make `userId` the owner if `code` matches the installer's claim code. */
export async function claimOwner(store: Store, code: string, userId: number): Promise<boolean> {
  const { claim_code, owner_id } = await store.getMany("claim_code", "owner_id");
  if (owner_id || !claim_code || !safeEqual(await sha256Hex(code), claim_code)) return false;
  await store.set("owner_id", userId);
  await store.delete("claim_code");
  return true;
}

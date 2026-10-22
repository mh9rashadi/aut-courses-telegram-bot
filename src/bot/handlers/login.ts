// Login: QR link text, /settoken, /logout.

import { Moodle, MoodleError, parseLoginQr } from "../../moodle/client";
import { esc } from "../../telegram/format";
import type { Ctx } from "../context";
import { DELETE_FAILED_TEXT, mainMenu, qrLoginErrorText } from "../texts";

async function acceptToken(ctx: Ctx, token: string): Promise<void> {
  const info = await new Moodle(ctx.env.MOODLE_URL, token).siteInfo();
  await ctx.store.setToken(token, info.userid);
  await ctx.send(`✅ وارد شدی: <b>${esc(info.fullname)}</b>`, mainMenu());
}

/** The message contains a secret: remove it from the chat history, and tell the user if that fails. */
async function deleteSecretMessage(ctx: Ctx, messageId: number): Promise<void> {
  await ctx.tg.deleteMessage(ctx.chatId, messageId).catch(() => ctx.send(DELETE_FAILED_TEXT));
}

/** Messages that contain the profile-page QR text. Returns false if `text` is not a login QR. */
export async function qrText(ctx: Ctx, text: string, messageId: number): Promise<boolean> {
  const qr = parseLoginQr(text);
  if (!qr) return false;
  await deleteSecretMessage(ctx, messageId);
  try {
    // Single attempt: retrying from the same IP can't fix ipmismatch and may use up the one-time key.
    const tokens = await ctx.anonymousMoodle().qrLogin(qr.key, qr.userid);
    await acceptToken(ctx, tokens.token);
  } catch (err) {
    if (!(err instanceof MoodleError)) throw err;
    await ctx.send(qrLoginErrorText(err.code));
  }
  return true;
}

export async function setToken(ctx: Ctx, args: string, messageId: number): Promise<void> {
  await deleteSecretMessage(ctx, messageId);
  const token = args.trim();
  if (!/^[0-9a-f]{32}$/.test(token)) {
    await ctx.send("فرمت: <code>/settoken TOKEN</code> (۳۲ کاراکتر)");
    return;
  }
  try {
    await acceptToken(ctx, token);
  } catch (err) {
    if (!(err instanceof MoodleError)) throw err;
    await ctx.send(`❌ توکن قبول نشد: <code>${esc(err.code)}</code>`);
  }
}

export async function logout(ctx: Ctx): Promise<void> {
  await ctx.store.delete("moodle_token", "upload");
  await ctx.send("توکن از ربات پاک شد. برای ورود دوباره /menu را بزن تا راهنمای ورود را ببینی.\n" +
    "این کار توکن را در خود کورسز باطل نمی‌کند. اگر فکر می‌کنی توکن لو رفته، راهنمای OPERATIONS.md را ببین.");
}

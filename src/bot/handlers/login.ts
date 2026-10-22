// Login: QR link text, /settoken, /logout.

import { Moodle, MoodleError, parseLoginQr } from "../../moodle/client";
import { esc } from "../../telegram/format";
import type { Ctx } from "../context";
import { mainMenu } from "../texts";

async function acceptToken(ctx: Ctx, token: string): Promise<void> {
  const info = await new Moodle(ctx.env.MOODLE_URL, token).siteInfo();
  await ctx.store.setToken(token, info.userid);
  await ctx.send(`✅ وارد شدی: <b>${esc(info.fullname)}</b>`, mainMenu());
}

/** Messages that contain the profile-page QR text. Returns false if `text` is not a login QR. */
export async function qrText(ctx: Ctx, text: string, messageId: number): Promise<boolean> {
  const qr = parseLoginQr(text);
  if (!qr) return false;
  await ctx.tg.deleteMessage(ctx.chatId, messageId).catch(() => {});
  try {
    const tokens = await ctx.anonymousMoodle().qrLogin(qr.key, qr.userid);
    await acceptToken(ctx, tokens.token);
  } catch (err) {
    if (!(err instanceof MoodleError)) throw err;
    await ctx.send(
      `❌ ورود با QR انجام نشد: <code>${esc(err.code)}</code>\n${esc(err.message)}\n\n` +
      "QR فقط ۱۰ دقیقه اعتبار دارد. اگر خطا تکرار شد (مثلاً مربوط به IP)، روی لپ‌تاپ " +
      "<code>npm run qr-token</code> را اجرا کن و خروجی <code>/settoken …</code> را بفرست.");
  }
  return true;
}

export async function setToken(ctx: Ctx, args: string, messageId: number): Promise<void> {
  // The message contains a secret: remove it from the chat history first.
  await ctx.tg.deleteMessage(ctx.chatId, messageId).catch(() => {});
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
  await ctx.send("توکن از ربات پاک شد. برای ورود دوباره متن لینک QR را بفرست.");
}

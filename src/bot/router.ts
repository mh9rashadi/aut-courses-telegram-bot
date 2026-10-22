// Dispatches one Telegram update: owner check, webhook-retry dedupe, commands, buttons, files.

import type { CallbackQuery, Message, Update } from "@grammyjs/types";
import { MoodleError, TokenInvalid } from "../moodle/client";
import { esc } from "../telegram/format";
import { Ctx } from "./context";
import * as asg from "./handlers/assignments";
import * as courses from "./handlers/courses";
import * as login from "./handlers/login";
import * as menu from "./handlers/menu";
import { claimOwner, ownerId } from "./owner";
import { NOT_CLAIMED_TEXT, RELOGIN_TEXT } from "./texts";

type ButtonHandler = (ctx: Ctx, args: string[]) => Promise<void>;

/** Buttons whose handler answers with its own toast; all others are answered immediately. */
const ANSWERS_ITSELF = new Set(["sub", "upok", "m"]);

/** Callback data is "<name>:<arg>:<arg>…". Keep names short: Telegram allows 64 bytes in total. */
const BUTTONS: Record<string, ButtonHandler> = {
  home: (ctx) => menu.home(ctx),
  deadlines: (ctx) => menu.deadlines(ctx),
  notifs: (ctx) => menu.notifications(ctx),
  status: (ctx) => menu.status(ctx),
  terms: courses.terms, // terms:cur | terms:all
  c: courses.course, // c:<courseId>
  sub: courses.toggleSubscription, // sub:<courseId>
  s: courses.section, // s:<courseId>:<sectionIndex>
  m: courses.module, // m:<courseId>:<cmid>
  f: courses.file, // f:<courseId>:<cmid>:<fileIndex>
  asg: asg.list, // asg:<courseId>
  a: asg.assignment, // a:<courseId>:<cmid>
  af: asg.attachment, // af:<courseId>:<cmid>:<index>
  up: asg.uploadStart, // up:<courseId>:<cmid>
  upok: asg.uploadCommit,
  upcancel: (ctx) => asg.uploadCancel(ctx),
  final: asg.finalConfirm, // final:<courseId>:<cmid>
  finalok: asg.finalSubmit, // finalok:<courseId>:<cmid>
};

export async function handleUpdate(update: Update, env: Env): Promise<void> {
  const message = update.message;
  const callback = update.callback_query;
  const from = message?.from ?? callback?.from;
  const chatId = message?.chat.id ?? callback?.message?.chat.id;
  if (!from || !chatId) return;

  const ctx = new Ctx(env, chatId, callback?.message?.message_id ?? null, callback?.id ?? null);
  let owner = await ownerId(env, ctx.store);
  if (owner === null) {
    const code = /^\/start\s+([\w-]+)/.exec(message?.text ?? "")?.[1];
    if (code && (await claimOwner(ctx.store, code, from.id))) {
      owner = from.id;
      await ctx.send("✅ ربات به اسم تو ثبت شد. از این به بعد فقط به تو جواب می‌دهد.");
    } else {
      if (message) await ctx.send(NOT_CLAIMED_TEXT);
      else await ctx.answer("ربات هنوز راه‌اندازی نشده", true);
      return;
    }
  }
  if (from.id !== owner) {
    if (message) await ctx.send("این ربات شخصی است.");
    else await ctx.answer("دسترسی ندارید", true);
    return;
  }

  // Telegram re-sends an update if the webhook was slow or failed; process each one once.
  if (!(await ctx.store.claimUpdate(update.update_id))) return;

  try {
    if (callback) await onButton(ctx, callback);
    else if (message) await onMessage(ctx, message);
  } catch (err) {
    await reportError(ctx, err);
  }
}

async function onButton(ctx: Ctx, cb: CallbackQuery): Promise<void> {
  const [name = "", ...args] = (cb.data ?? "").split(":");
  const handler = BUTTONS[name];
  if (!handler) {
    await ctx.answer("این دکمه قدیمی است؛ /menu را بزن.");
    return;
  }
  // Answer before slow Moodle calls so the spinner stops (Telegram expires unanswered queries).
  if (!ANSWERS_ITSELF.has(name)) await ctx.answer();
  try {
    await handler(ctx, args);
  } finally {
    await ctx.answer();
  }
}

async function onMessage(ctx: Ctx, msg: Message): Promise<void> {
  const text = msg.text ?? "";
  const command = /^\/(\w+)(?:@\w+)?\s*([\s\S]*)$/.exec(text);
  if (command) {
    const [, name, args = ""] = command;
    switch (name) {
      case "start":
      case "menu":
        return menu.home(ctx);
      case "settoken":
        return login.setToken(ctx, args, msg.message_id);
      case "logout":
        return login.logout(ctx);
      case "status":
        return menu.status(ctx);
    }
  }
  if (text && (await login.qrText(ctx, text, msg.message_id))) return;
  if (await asg.uploadFile(ctx, msg.document, msg.photo, msg.message_id)) return;
  if (msg.photo) {
    await ctx.send("عکس QR را نمی‌توانم بخوانم؛ QR را با دوربین گوشی اسکن کن و <b>متن لینک</b> را بفرست.");
    return;
  }
  await menu.home(ctx);
}

async function reportError(ctx: Ctx, err: unknown): Promise<void> {
  let text: string;
  if (err instanceof TokenInvalid) {
    text = RELOGIN_TEXT;
  } else if (err instanceof MoodleError && (err.code === "network" || err.code === "http")) {
    text = "📡 کورسز در دسترس نیست. کمی بعد دوباره امتحان کن.";
  } else if (err instanceof MoodleError) {
    text = `⚠️ خطای کورسز: <code>${esc(err.code)}</code>\n${esc(err.message).slice(0, 300)}`;
  } else {
    console.error("handler error", err);
    text = "⚠️ خطای غیرمنتظره؛ دوباره امتحان کن.";
  }
  await ctx.send(text).catch((e) => console.error("could not report error", e));
}

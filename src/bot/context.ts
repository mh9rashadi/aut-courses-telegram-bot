// Per-update context passed to every handler: clients, state, and a `show()` helper for the panel.

import type { InlineKeyboardMarkup } from "@grammyjs/types";
import { Moodle } from "../moodle/client";
import { Store } from "../store";
import { Telegram } from "../telegram/api";
import { truncate } from "../telegram/format";

export class Ctx {
  readonly tg: Telegram;
  readonly store: Store;
  private moodleClient: Moodle | null = null;
  private answered = false;

  constructor(
    readonly env: Env,
    readonly chatId: number,
    /** Set for button presses: show() edits this message instead of sending a new one. */
    readonly panelMessageId: number | null = null,
    /** Set for button presses: the callback query that must be answered once. */
    readonly callbackId: string | null = null,
  ) {
    this.tg = new Telegram(env.BOT_TOKEN);
    this.store = new Store(env.DB, env.TOKEN_KEY);
  }

  /** Answer the button press (stops the spinner; optional toast). Only the first call has an effect. */
  async answer(text?: string, alert = false): Promise<void> {
    if (!this.callbackId || this.answered) return;
    this.answered = true;
    await this.tg.answerCallback(this.callbackId, text, alert).catch(() => {});
  }

  /** Moodle client with the stored token (throws TokenInvalid on use if there is none). */
  async moodle(): Promise<Moodle> {
    this.moodleClient ??= new Moodle(this.env.MOODLE_URL, await this.store.getToken());
    return this.moodleClient;
  }

  /** Moodle client without a token, for QR login. */
  anonymousMoodle(): Moodle {
    return new Moodle(this.env.MOODLE_URL, null);
  }

  /** Show a screen: edit the panel for button presses, send a new message for commands. */
  async show(text: string, markup?: InlineKeyboardMarkup): Promise<void> {
    const body = truncate(text);
    const opts = markup ? { reply_markup: markup } : {};
    if (this.panelMessageId) await this.tg.editOrSend(this.chatId, this.panelMessageId, body, opts);
    else await this.tg.sendMessage(this.chatId, body, opts);
  }

  /** Always send a new message (notes, confirmations). */
  send(text: string, markup?: InlineKeyboardMarkup) {
    return this.tg.sendMessage(this.chatId, truncate(text), markup ? { reply_markup: markup } : {});
  }
}

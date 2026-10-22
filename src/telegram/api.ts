// Minimal Telegram Bot API client. Types come from @grammyjs/types (type-only, no runtime code).
// Bot API docs: https://core.telegram.org/bots/api

import type { InlineKeyboardMarkup, Message } from "@grammyjs/types";

/** Cloud Bot API limits: bots send files up to 50 MB and download (getFile) up to 20 MB. */
export const MAX_SEND_BYTES = 49 * 1024 * 1024;
export const MAX_RECEIVE_BYTES = 20 * 1024 * 1024;

export class TelegramError extends Error {
  constructor(readonly method: string, readonly code: number, readonly description: string) {
    super(`${method}: ${code} ${description}`);
  }
}

export interface SendOptions {
  reply_markup?: InlineKeyboardMarkup;
}

export class Telegram {
  private readonly base: string;

  constructor(token: string) {
    this.base = `https://api.telegram.org/bot${token}`;
  }

  async call<T>(method: string, params: object | FormData = {}): Promise<T> {
    const init: RequestInit = params instanceof FormData
      ? { method: "POST", body: params }
      : { method: "POST", body: JSON.stringify(params), headers: { "content-type": "application/json" } };
    const resp = await fetch(`${this.base}/${method}`, init);
    const data = (await resp.json()) as { ok: boolean; result: T; error_code: number; description: string };
    if (!data.ok) throw new TelegramError(method, data.error_code, data.description);
    return data.result;
  }

  sendMessage(chatId: number, text: string, opts: SendOptions = {}): Promise<Message.TextMessage> {
    return this.call("sendMessage", {
      chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...opts,
    });
  }

  /** Edit a panel message. Falls back to a new message if Telegram refuses (too old, same text, ...). */
  async editOrSend(chatId: number, messageId: number, text: string, opts: SendOptions = {}): Promise<void> {
    try {
      await this.call("editMessageText", {
        chat_id: chatId, message_id: messageId, text, parse_mode: "HTML",
        link_preview_options: { is_disabled: true }, ...opts,
      });
    } catch (err) {
      if (err instanceof TelegramError && err.description.includes("message is not modified")) return;
      await this.sendMessage(chatId, text, opts);
    }
  }

  answerCallback(id: string, text?: string, alert = false): Promise<true> {
    return this.call("answerCallbackQuery", { callback_query_id: id, text, show_alert: alert });
  }

  deleteMessage(chatId: number, messageId: number): Promise<true> {
    return this.call("deleteMessage", { chat_id: chatId, message_id: messageId });
  }

  sendDocument(chatId: number, file: Blob, filename: string, caption?: string): Promise<Message> {
    const form = new FormData();
    form.set("chat_id", String(chatId));
    form.set("document", file, filename);
    if (caption) {
      form.set("caption", caption);
      form.set("parse_mode", "HTML");
    }
    return this.call("sendDocument", form);
  }

  /**
   * Send a document by piping `body` straight into a hand-built multipart request.
   * The bytes never pass through JavaScript (unlike Blob + FormData), which keeps CPU time near zero even for
   * 50 MB files. `size` must be the exact byte length of `body` (multipart needs a fixed Content-Length).
   */
  async sendDocumentStream(chatId: number, body: ReadableStream<Uint8Array>, size: number, filename: string):
    Promise<Message> {
    const boundary = `----aut${crypto.randomUUID()}`;
    const enc = new TextEncoder();
    const safeName = filename.replace(/["\r\n]/g, "_");
    const head = enc.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${safeName}"\r\n` +
      "Content-Type: application/octet-stream\r\n\r\n");
    const tail = enc.encode(`\r\n--${boundary}--\r\n`);

    const { readable, writable } = new FixedLengthStream(head.length + size + tail.length);
    const pump = (async () => {
      const writer = writable.getWriter();
      await writer.write(head);
      writer.releaseLock();
      await body.pipeTo(writable, { preventClose: true });
      const closer = writable.getWriter();
      await closer.write(tail);
      await closer.close();
    })();
    const [resp] = await Promise.all([
      fetch(`${this.base}/sendDocument`, {
        method: "POST", body: readable, headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      }),
      pump,
    ]);
    const data = (await resp.json()) as { ok: boolean; result: Message; error_code: number; description: string };
    if (!data.ok) throw new TelegramError("sendDocument", data.error_code, data.description);
    return data.result;
  }

  /** Download a file the user sent to the bot (max 20 MB on the cloud Bot API). */
  async downloadFile(fileId: string): Promise<Blob> {
    const file = await this.call<{ file_path?: string }>("getFile", { file_id: fileId });
    if (!file.file_path) throw new TelegramError("getFile", 400, "file is too big or unavailable");
    const resp = await fetch(`${this.base.replace("/bot", "/file/bot")}/${file.file_path}`);
    if (!resp.ok) throw new TelegramError("downloadFile", resp.status, resp.statusText);
    return resp.blob();
  }
}

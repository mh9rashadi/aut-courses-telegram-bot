#!/usr/bin/env node
// Point the Telegram bot at the deployed Worker (npm run setup already does this once).
// Reads BOT_TOKEN and WEBHOOK_SECRET from .dev.vars or the environment. User-facing output is Persian.
//
//   npm run webhook -- https://aut-courses-bot.<subdomain>.workers.dev   register
//   npm run webhook -- --info                                           show current webhook state
//   npm run webhook -- --delete                                         remove

import { readDevVars, registerWebhook, telegram } from "./lib.mjs";

const { BOT_TOKEN, WEBHOOK_SECRET } = { ...readDevVars(), ...process.env };

function fail(text) {
  console.error(`❌ ${text}`);
  process.exit(1);
}

if (!BOT_TOKEN) fail("توکن ربات (BOT_TOKEN) پیدا نشد. اول npm run setup را بزن، یا آن را در فایل .dev.vars بگذار.");

const arg = process.argv[2];
try {
  if (arg === "--info") {
    console.log(JSON.stringify(await telegram(BOT_TOKEN, "getWebhookInfo"), null, 2));
  } else if (arg === "--delete") {
    await telegram(BOT_TOKEN, "deleteWebhook");
    console.log("اتصال تلگرام به Worker حذف شد.");
  } else if (arg?.startsWith("https://")) {
    if (!WEBHOOK_SECRET) fail("WEBHOOK_SECRET پیدا نشد. آن را در فایل .dev.vars بگذار.");
    await registerWebhook(BOT_TOKEN, WEBHOOK_SECRET, arg);
    const { pending_update_count, last_error_message } = await telegram(BOT_TOKEN, "getWebhookInfo");
    console.log("✅ تلگرام به Worker وصل شد.", { pending_update_count, last_error_message });
  } else {
    fail("طرز استفاده: npm run webhook -- <آدرس Worker> | --info | --delete");
  }
} catch (err) {
  if (/resolve host|name resolution/i.test(err.message)) {
    fail("تلگرام هنوز آدرس Worker را پیدا نمی‌کند (آدرس‌های workers.dev تازه چند دقیقه طول می‌کشند). " +
      "چند دقیقه صبر کن و دوباره بزن.");
  }
  fail(err.message);
}

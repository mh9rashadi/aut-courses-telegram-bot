#!/usr/bin/env node
// Point the Telegram bot at the deployed Worker (npm run setup already does this once).
// Reads BOT_TOKEN and WEBHOOK_SECRET from .dev.vars or the environment.
//
//   npm run webhook -- https://aut-courses-bot.<subdomain>.workers.dev   register
//   npm run webhook -- --info                                           show current webhook state
//   npm run webhook -- --delete                                         remove

import { readDevVars, registerWebhook, telegram } from "./lib.mjs";

const { BOT_TOKEN, WEBHOOK_SECRET } = { ...readDevVars(), ...process.env };
if (!BOT_TOKEN) throw new Error("BOT_TOKEN missing (run npm run setup, or put it in .dev.vars)");

const arg = process.argv[2];
if (arg === "--info") {
  console.log(JSON.stringify(await telegram(BOT_TOKEN, "getWebhookInfo"), null, 2));
} else if (arg === "--delete") {
  await telegram(BOT_TOKEN, "deleteWebhook");
  console.log("Webhook removed.");
} else if (arg?.startsWith("https://")) {
  if (!WEBHOOK_SECRET) throw new Error("WEBHOOK_SECRET missing (put it in .dev.vars)");
  await registerWebhook(BOT_TOKEN, WEBHOOK_SECRET, arg);
  const { pending_update_count, last_error_message } = await telegram(BOT_TOKEN, "getWebhookInfo");
  console.log("Webhook and commands set.", { pending_update_count, last_error_message });
} else {
  console.log("Usage: npm run webhook -- <worker-url> | --info | --delete");
  process.exit(1);
}

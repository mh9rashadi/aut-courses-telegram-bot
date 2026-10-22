#!/usr/bin/env node
// One-command setup on your own Cloudflare account: npm run setup
// Safe to re-run: existing values in .dev.vars are kept (a new TOKEN_KEY would make the stored login unreadable).
//
// Steps: Cloudflare login → bot token + your Telegram id → generate secrets → create D1 database + tables →
// deploy the Worker → point the Telegram bot at it.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { readDevVars, registerWebhook, telegram, writeDevVars } from "./lib.mjs";

const DB_NAME = "aut-courses-bot";
const rl = createInterface({ input: process.stdin, output: process.stdout });

// Arguments are fixed strings from this file (no user input), joined into one shell command because
// `npx` is a .cmd script on Windows and needs a shell.
const run = (args, stdio) => spawnSync(`npx wrangler ${args.join(" ")}`, { shell: true, encoding: "utf8", stdio });

function wrangler(args, { capture = false } = {}) {
  const res = run(args, capture ? ["inherit", "pipe", "inherit"] : "inherit");
  if (capture && res.stdout) process.stdout.write(res.stdout);
  if (res.status !== 0) throw new Error(`wrangler ${args[0]} failed`);
  return res.stdout ?? "";
}

function step(n, text) {
  console.log(`\n── ${n}. ${text}`);
}

try {
  step(1, "Cloudflare account");
  const who = run(["whoami"], "pipe");
  if (/not authenticated/i.test(who.stdout + who.stderr)) {
    console.log("A browser window opens: log in to Cloudflare (free account) and allow Wrangler.");
    wrangler(["login"]);
  } else {
    console.log("Already logged in.");
  }

  step(2, "Telegram bot");
  const vars = readDevVars();
  while (true) {
    vars.BOT_TOKEN ||= (await rl.question("Bot token from @BotFather (/newbot): ")).trim();
    try {
      const me = await telegram(vars.BOT_TOKEN, "getMe");
      console.log(`Bot: @${me.username}`);
      break;
    } catch {
      console.log("That token was not accepted by Telegram, try again.");
      vars.BOT_TOKEN = "";
    }
  }
  while (!/^\d+$/.test(vars.OWNER_ID ?? "")) {
    vars.OWNER_ID = (await rl.question("Your numeric Telegram id (send /start to @userinfobot to see it): ")).trim();
  }
  vars.WEBHOOK_SECRET ||= randomBytes(32).toString("base64url");
  vars.TOKEN_KEY ||= randomBytes(32).toString("base64");
  writeDevVars(vars);
  console.log("Saved to .dev.vars (git-ignored).");

  step(3, "Database");
  const dbs = JSON.parse(run(["d1", "list", "--json"], "pipe").stdout || "[]");
  // wrangler.jsonc already has the binding (found by name), so don't let `d1 create` edit the config.
  if (!dbs.some((db) => db.name === DB_NAME)) wrangler(["d1", "create", DB_NAME, "--no-update-config"]);
  wrangler(["d1", "migrations", "apply", DB_NAME, "--remote"]);

  step(4, "Deploy the Worker");
  const out = wrangler(["deploy", "--secrets-file", ".dev.vars"], { capture: true });
  const url = /https:\/\/[\w.-]+\.workers\.dev/.exec(out)?.[0];
  if (!url) throw new Error("Could not find the workers.dev URL in the deploy output; run: npm run webhook -- <url>");

  step(5, "Connect Telegram to the Worker");
  await registerWebhook(vars.BOT_TOKEN, vars.WEBHOOK_SECRET, url);
  console.log(`Webhook → ${url}/telegram`);

  console.log("\n✅ Done. Open your bot in Telegram, send /start, then log in with the courses QR text (see README).");
} catch (err) {
  console.error(`\n❌ ${err.message}`);
  process.exitCode = 1;
} finally {
  rl.close();
}

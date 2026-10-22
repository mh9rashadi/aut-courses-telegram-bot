#!/usr/bin/env node
// One-command setup on your own Cloudflare account: npm run setup
// Safe to re-run after any failure: existing values in .dev.vars are kept (a new TOKEN_KEY would make the stored
// login unreadable) and the database is reused by name.
//
// Steps: Cloudflare login + workers.dev check → bot token + your Telegram id → generate secrets →
// create D1 database + tables → deploy the Worker → point the Telegram bot at it.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { deployErrorHelp, readDevVars, registerWebhook, telegram, writeDevVars } from "./lib.mjs";

const DB_NAME = "aut-courses-bot";
const WORKER_NAME = /"name"\s*:\s*"([^"]+)"/.exec(readFileSync("wrangler.jsonc", "utf8"))?.[1] ?? "aut-courses-bot";
const rl = createInterface({ input: process.stdin, output: process.stdout });

// Arguments are fixed strings from this file (no user input), joined into one shell command because
// `npx` is a .cmd script on Windows and needs a shell.
function run(args, stdio) {
  const res = spawnSync(`npx wrangler ${args.join(" ")}`, { shell: true, encoding: "utf8", stdio });
  if (res.error) throw new Error(`Could not start wrangler (${res.error.message}). Did \`npm install\` finish?`);
  return res;
}

function wrangler(args, { capture = false } = {}) {
  const res = run(args, capture ? ["inherit", "pipe", "pipe"] : "inherit");
  if (capture) {
    process.stdout.write(res.stdout ?? "");
    process.stderr.write(res.stderr ?? "");
  }
  if (res.status !== 0) {
    throw new Error(deployErrorHelp(`${res.stdout ?? ""}\n${res.stderr ?? ""}`) ?? `wrangler ${args[0]} failed (see above)`);
  }
  return res.stdout ?? "";
}

function step(n, text) {
  console.log(`\n── ${n}. ${text}`);
}

/**
 * The Worker is published on <name>.<account-subdomain>.workers.dev. A new Cloudflare account has no subdomain yet,
 * and wrangler can't ask for one when run from this script, so check before creating anything.
 * Returns the subdomain, or null if it couldn't be checked (deploy then reports the problem itself).
 */
async function workersDevSubdomain() {
  let status, data;
  try {
    const who = JSON.parse(run(["whoami", "--json"], "pipe").stdout);
    if (who.accounts?.length !== 1) return null; // several accounts: wrangler asks which one at deploy
    const { token } = JSON.parse(run(["auth", "token", "--json"], "pipe").stdout);
    const resp = await fetch(`https://api.cloudflare.com/client/v4/accounts/${who.accounts[0].id}/workers/subdomain`,
      { headers: { authorization: `Bearer ${token}` } });
    status = resp.status;
    data = await resp.json();
  } catch {
    return null; // older wrangler, network trouble, …: not fatal here
  }
  if (data.success && data.result?.subdomain) return data.result.subdomain;
  if (status === 404 || data.success) throw new Error(deployErrorHelp("register a workers.dev subdomain"));
  return null;
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
  const subdomain = await workersDevSubdomain();
  console.log(subdomain ? `workers.dev subdomain: ${subdomain}.workers.dev` : "workers.dev subdomain: not checked");

  step(2, "Telegram bot");
  const vars = readDevVars();
  while (true) {
    vars.BOT_TOKEN ||= (await rl.question("Bot token from @BotFather (/newbot): ")).trim();
    if (!/^\d+:[\w-]{30,}$/.test(vars.BOT_TOKEN)) {
      console.log("That doesn't look like a bot token (digits:letters). Copy it again from @BotFather.");
      vars.BOT_TOKEN = "";
      continue;
    }
    try {
      const me = await telegram(vars.BOT_TOKEN, "getMe");
      console.log(`Bot: @${me.username}`);
      break;
    } catch (err) {
      if (/^Telegram getMe:/.test(err.message)) {
        // Telegram answered and refused the token (e.g. "Unauthorized": revoked or mistyped).
        console.log(`Telegram refused that token (${err.message.slice(14)}). Copy it again from @BotFather.`);
        vars.BOT_TOKEN = "";
      } else {
        // No answer at all: api.telegram.org is blocked on many networks (e.g. in Iran). The token may be fine.
        console.log("Could not reach api.telegram.org, so the token couldn't be checked. It may be blocked on " +
          "your network:\nturn on a VPN that lets this terminal reach Telegram, then press Enter to retry.");
        await rl.question("");
      }
    }
  }
  while (!/^\d+$/.test(vars.OWNER_ID ?? "")) {
    vars.OWNER_ID = (await rl.question("Your numeric Telegram id (send /start to @userinfobot to see it): ")).trim();
  }
  vars.WEBHOOK_SECRET ||= randomBytes(32).toString("base64url");
  vars.TOKEN_KEY ||= randomBytes(32).toString("base64");
  writeDevVars(vars);
  console.log("Saved to .dev.vars (git-ignored). It holds your bot's passwords: never share or upload it.");

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

  console.log("\n✅ Done.");
  console.log(`   Worker:  ${WORKER_NAME}  (Cloudflare dashboard → Workers & Pages; other Workers there are not used)`);
  console.log(`   URL:     ${url}`);
  console.log(`   Webhook: ${url}/telegram`);
  console.log("\nNext: open your bot in Telegram, send /start, then log in with: npm run qr-token (see README).");
  console.log("🔒 Never post your bot token, .dev.vars, the QR text or a /settoken line in chats, issues or screenshots.");
} catch (err) {
  console.error(`\n❌ ${err.message}`);
  console.error("Fix the problem above and run `npm run setup` again: finished steps and saved secrets are reused.");
  process.exitCode = 1;
} finally {
  rl.close();
}

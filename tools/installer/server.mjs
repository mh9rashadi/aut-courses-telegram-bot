#!/usr/bin/env node
// Browser installer: a local web page (Persian, step by step) that runs the steps in tools/steps.mjs.
// Started by install.cmd (Windows) or `npm run installer`. Listens on 127.0.0.1 only; every API call must carry
// the random key that is in the URL we open, so other web pages can't drive it.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
process.chdir(ROOT); // wrangler.jsonc, .dev.vars and node_modules are relative to the project root

const { StepError, WORKER_NAME, cloudflareLogin, cloudflareLogout, cloudflareStatus, connectTelegram, deployWorker,
  loginWithQr, saveBotSettings, setupDatabase } = await import("../steps.mjs");
const { readDevVars } = await import("../lib.mjs");

const KEY = randomBytes(16).toString("hex");
const STATE_FILE = ".installer-state.json"; // git-ignored; progress only, no secrets

const readState = () => (existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {});
const saveState = (patch) => writeFileSync(STATE_FILE, JSON.stringify({ ...readState(), ...patch }, null, 2));

const STATIC = {
  "/": ["tools/installer/index.html", "text/html; charset=utf-8"],
  "/app.js": ["tools/installer/app.js", "text/javascript; charset=utf-8"],
  "/jsqr.js": ["node_modules/jsqr/dist/jsQR.js", "text/javascript; charset=utf-8"],
};

const API = {
  async state() {
    const vars = readDevVars();
    return {
      cloudflare: await cloudflareStatus(),
      botSaved: Boolean(vars.BOT_TOKEN && vars.OWNER_ID),
      worker: WORKER_NAME,
      ...readState(),
    };
  },
  async cfLogin() {
    await cloudflareLogin();
    return {};
  },
  async cfLogout() {
    await cloudflareLogout();
    saveState({ workerUrl: null, telegramOk: false, bot: null, moodleName: null });
    return {};
  },
  async bot({ token, ownerId }) {
    const res = await saveBotSettings(token, ownerId);
    // A new token means the deployed Worker has the old one: deploy and connect again.
    saveState({ bot: res.bot ?? null, workerUrl: null, telegramOk: false });
    return res;
  },
  async install() {
    const log = [];
    await setupDatabase((line) => log.push(line));
    const workerUrl = await deployWorker((line) => log.push(line));
    saveState({ workerUrl });
    return { workerUrl, log };
  },
  async telegram() {
    const { workerUrl } = readState();
    if (!workerUrl) throw new StepError("اول مرحله‌ی نصب ربات را انجام بده.");
    const res = await connectTelegram(workerUrl);
    if (res.ok) saveState({ telegramOk: true, bot: res.bot });
    return res;
  },
  async login({ qr }) {
    const res = await loginWithQr(qr);
    saveState({ moodleName: res.name });
    return res;
  },
  async quit() {
    setTimeout(() => process.exit(0), 200);
    return {};
  },
};

// One step at a time: wrangler commands must not overlap.
let queue = Promise.resolve();
const serialized = (fn) => (queue = queue.then(fn, fn));

async function readBody(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  const send = (status, body, type = "application/json; charset=utf-8") => {
    res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
    res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };

  if (req.method === "GET" && STATIC[path]) {
    const [file, type] = STATIC[path];
    return existsSync(file) ? send(200, readFileSync(file), type) : send(404, "missing " + file, "text/plain");
  }
  const name = path.startsWith("/api/") ? path.slice(5) : "";
  if (req.method !== "POST" || !Object.hasOwn(API, name)) return send(404, { error: "not found" });
  if (req.headers["x-installer-key"] !== KEY) return send(403, { error: "forbidden" });

  try {
    const body = await readBody(req);
    send(200, await serialized(() => API[name](body)));
  } catch (err) {
    if (!(err instanceof StepError)) console.error(err);
    send(200, { error: err instanceof StepError ? err.message : `خطای پیش‌بینی‌نشده: ${err.message}`,
      code: err.code ?? "error" });
  }
});

function openBrowser(url) {
  const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}

server.listen(0, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${server.address().port}/?k=${KEY}`;
  console.log("\nThe installer is open in your browser. If it did not open, copy this address into your browser:");
  console.log(`  ${url}`);
  console.log("Keep this window open until the installer says it is finished.\n");
  if (!process.argv.includes("--no-open")) openBrowser(url);
});

#!/usr/bin/env node
// Login: redeem the courses profile-page QR on this computer and print a /settoken line for the bot.
// This is the main login path: the site may only accept a QR from the IP that displayed it, and the Worker's IP
// is different (error ipmismatch when the QR text is sent to the bot).
//
// 1. courses.aut.ac.ir → profile → «نمایش کد کیوآر» (valid 10 minutes, one use)
// 2. Scan it with a phone camera / Google Lens and copy the text (moodlemobile://…?qrlogin=…&userid=…)
// 3. npm run qr-token   → paste the text when asked (keeps it out of your shell history)
// 4. Send the printed /settoken line to your own bot (the bot deletes the message).

import { createInterface } from "node:readline/promises";
import { MOODLE, inputHelp, parseQrInput, qrErrorHelp } from "./qr.mjs";

async function readQrText() {
  if (process.argv[2]) return process.argv.slice(2).join(" ");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question("Paste the QR text (moodlemobile://…qrlogin=…&userid=…) and press Enter:\n> ");
  } finally {
    rl.close();
  }
}

function fail(text) {
  console.error(`\n❌ ${text}`);
  process.exit(1);
}

const qr = parseQrInput(await readQrText());
if (qr.error) fail(inputHelp(qr.error));

let res;
try {
  const resp = await fetch(`${MOODLE}/lib/ajax/service-nologin.php?info=tool_mobile_get_tokens_for_qr_login`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "MoodleMobile 4.5.0" },
    body: JSON.stringify([{ index: 0, methodname: "tool_mobile_get_tokens_for_qr_login",
      args: { qrloginkey: qr.key, userid: qr.userid } }]),
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) fail(`HTTP ${resp.status}. ${qrErrorHelp("badresponse")}`);
  [res] = await resp.json().catch(() => [null]);
} catch {
  fail(qrErrorHelp("network"));
}
if (!res) fail(qrErrorHelp("badresponse"));
if (res.error || !res.data?.token) {
  // Only the error code is printed: the raw response isn't needed and must not end up in shared logs.
  const code = String(res.exception?.errorcode ?? "unknown");
  fail(`QR login failed (${code}). ${qrErrorHelp(code)}`);
}

console.log("\n✅ Send this line to YOUR OWN bot in Telegram. It works like your courses password: don't share it");
console.log("   or post it in issues/screenshots. The bot deletes the message after reading it.\n");
console.log(`/settoken ${res.data.token}\n`);

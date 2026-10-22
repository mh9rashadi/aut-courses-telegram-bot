#!/usr/bin/env node
// Fallback login: redeem the courses profile-page QR on this computer and print a /settoken line.
// Use it if sending the QR text to the bot fails (e.g. the site requires the same IP that showed the QR).
//
// 1. courses.aut.ac.ir → profile → «نمایش کد کیوآر» (valid 10 minutes)
// 2. Scan it with a phone camera / Google Lens and copy the text (moodlemobile://…?qrlogin=…&userid=…)
// 3. npm run qr-token -- "<that text>"
// 4. Send the printed /settoken line to the bot (the bot deletes the message).

const MOODLE = "https://courses.aut.ac.ir";
const text = process.argv[2] ?? "";
const key = /[?&]qrlogin=([^&\s]+)/.exec(text)?.[1];
const userid = /[?&]userid=(\d+)/.exec(text)?.[1];
if (!key || !userid) {
  console.error('Usage: npm run qr-token -- "moodlemobile://https://courses.aut.ac.ir?qrlogin=KEY&userid=ID"');
  process.exit(1);
}

const resp = await fetch(`${MOODLE}/lib/ajax/service-nologin.php?info=tool_mobile_get_tokens_for_qr_login`, {
  method: "POST",
  headers: { "content-type": "application/json", "user-agent": "MoodleMobile 4.5.0" },
  body: JSON.stringify([{ index: 0, methodname: "tool_mobile_get_tokens_for_qr_login",
    args: { qrloginkey: key, userid: Number(userid) } }]),
});
const [res] = await resp.json();
if (res?.error || !res?.data?.token) {
  console.error("QR login failed:", res?.exception?.errorcode, res?.exception?.message);
  process.exit(1);
}
console.log("Send this to the bot:");
console.log(`/settoken ${res.data.token}`);

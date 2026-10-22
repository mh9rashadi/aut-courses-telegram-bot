#!/usr/bin/env node
// Terminal version of the installer (npm run setup), for people who prefer it or have no browser at hand.
// Most users should double-click install.cmd / run `npm run installer` (browser, Persian, step by step).
// Same steps as the browser installer (tools/steps.mjs); safe to re-run after any failure.

import { createInterface } from "node:readline/promises";
import { readDevVars } from "./lib.mjs";
import { StepError, WORKER_NAME, cloudflareLogin, cloudflareStatus, connectTelegram, deployWorker, loginWithQr,
  saveBotSettings, setupDatabase } from "./steps.mjs";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (line) => console.log(`   ${line}`);

function step(n, title) {
  console.log(`\n── مرحله‌ی ${n} از ۵: ${title}`);
}

try {
  step(1, "ورود به Cloudflare");
  let cf = await cloudflareStatus();
  if (!cf.loggedIn) {
    console.log("الان مرورگر باز می‌شود: وارد اکانت Cloudflare شو و دکمه‌ی Allow را بزن.");
    await cloudflareLogin();
    cf = await cloudflareStatus();
  }
  while (cf.subdomain === "") {
    console.log("اکانتت هنوز زیردامنه‌ی workers.dev ندارد. این صفحه را باز کن و یک اسم انتخاب کن:\n" +
      "https://dash.cloudflare.com/?to=/:account/workers-and-pages");
    await rl.question("بعد از انتخاب، Enter بزن… ");
    cf = await cloudflareStatus();
  }
  console.log(`وارد شدی: ${cf.email}`);

  step(2, "ربات تلگرام");
  if (readDevVars().BOT_TOKEN && readDevVars().OWNER_ID) {
    console.log("توکن ربات و آیدی از قبل در .dev.vars ذخیره شده‌اند.");
  } else {
    while (true) {
      const token = await rl.question("توکن ربات از @BotFather: ");
      const owner = await rl.question("آیدی عددی تلگرامت (از @userinfobot): ");
      try {
        const res = await saveBotSettings(token, owner);
        console.log(res.bot ? `ربات پیدا شد: @${res.bot}` :
          "تلگرام از این کامپیوتر در دسترس نیست؛ توکن بعد از نصب از سمت Cloudflare بررسی می‌شود.");
        break;
      } catch (err) {
        if (!(err instanceof StepError)) throw err;
        console.log(`❌ ${err.message}`);
      }
    }
  }

  step(3, "نصب ربات روی Cloudflare");
  await setupDatabase(log);
  const url = await deployWorker(log);
  log(`آدرس: ${url}`);

  step(4, "وصل کردن تلگرام");
  for (let attempt = 0; ; attempt++) {
    const res = await connectTelegram(url);
    if (res.ok) {
      console.log(`وصل شد: @${res.bot}`);
      break;
    }
    if (res.tokenRefused) {
      throw new StepError(`تلگرام توکن ربات را قبول نکرد (${res.error}). فایل .dev.vars را پاک کن و دوباره npm run setup بزن.`);
    }
    if (attempt === 0) {
      console.log("آدرس ربات تازه ساخته شده و چند دقیقه طول می‌کشد تا تلگرام پیدایش کند (گاهی تا ۱۵ دقیقه).\n" +
        "هر ۲۰ ثانیه دوباره امتحان می‌کنم؛ این پنجره را نبند.");
    }
    process.stdout.write(".");
    await sleep(20_000);
  }

  step(5, "ورود به کورسز");
  console.log("در کورسز (روی همین کامپیوتر) پروفایل ← «نمایش کد کیوآر». QR را با گوشی اسکن کن و متنش را این‌جا بده.\n" +
    "(در نسخه‌ی مرورگری کافی است از QR عکس بگیری: npm run installer)");
  while (true) {
    try {
      const { name } = await loginWithQr(await rl.question("متن QR: "));
      console.log(`وارد شدی: ${name}`);
      break;
    } catch (err) {
      if (!(err instanceof StepError)) throw err;
      console.log(`❌ ${err.message}`);
    }
  }

  console.log(`\n✅ تمام شد. Worker: ${WORKER_NAME} (${url}). در تلگرام به رباتت /start بده.`);
} catch (err) {
  console.error(`\n❌ ${err.message}`);
  console.error("مشکل را حل کن و دوباره npm run setup بزن؛ مرحله‌های تمام‌شده دوباره لازم نیستند.");
  process.exitCode = 1;
} finally {
  rl.close();
}

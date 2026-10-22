#!/usr/bin/env node
// Remove the bot from your Cloudflare account and this computer: npm run uninstall (or double-click uninstall.cmd).
//   --yes      don't ask for confirmation
//   --logout   also log wrangler out of Cloudflare (so the next install starts from the Cloudflare login)

import { createInterface } from "node:readline/promises";
import { StepError, cloudflareLogout, cloudflareStatus, uninstall } from "./steps.mjs";

const args = process.argv.slice(2);

try {
  const cf = await cloudflareStatus();
  if (!cf.loggedIn) {
    throw new StepError("به Cloudflare وصل نیستی، پس نمی‌دانم ربات روی کدام اکانت است. اول بزن npx wrangler login.");
  }
  console.log(`اکانت Cloudflare: ${cf.email}`);
  console.log("ربات، دیتابیسش (با اطلاعات ورود به کورسز) و رمزهای ذخیره‌شده روی این کامپیوتر پاک می‌شوند.");
  if (!args.includes("--yes")) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question("برای حذف بنویس yes و Enter بزن: ");
    rl.close();
    if (answer.trim().toLowerCase() !== "yes") {
      console.log("لغو شد؛ چیزی پاک نشد.");
      process.exit(0);
    }
  }
  await uninstall((line) => console.log(`✓ ${line}`));
  if (args.includes("--logout")) {
    await cloudflareLogout();
    console.log("✓ از Cloudflare خارج شدی.");
  }
  console.log("\n✅ حذف تمام شد. خود ربات تلگرام در @BotFather می‌ماند؛ اگر نمی‌خواهی‌اش، آن‌جا /deletebot بزن.");
} catch (err) {
  console.error(`\n❌ ${err instanceof StepError ? err.message : err}`);
  process.exitCode = 1;
}

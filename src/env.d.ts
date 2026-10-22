// Optional secrets. `wrangler types` only lists the required ones (wrangler.jsonc), so these are declared here.
interface Env {
  /** Owner's Telegram id on older installs; newer ones claim the bot through the installer (bot/owner.ts). */
  OWNER_ID?: string;
}

// All persistent state, in D1 (schema: migrations/). This is the only module that writes SQL.

import { decrypt, encrypt } from "./crypto";
import type { Snapshot } from "./poller/snapshot";
import type { SetupStatus } from "./setup";

/** Typed keys of the `kv` table. Add new keys here; values are stored as JSON. */
export interface KvValues {
  moodle_token: string; // encrypted, see crypto.ts
  moodle_userid: number;
  last_update_id: number; // highest Telegram update processed (dedupes webhook retries)
  last_notification_id: number; // highest Moodle popup notification already forwarded
  last_cron_at: number; // unix time of the last finished background run (heartbeat)
  token_alerted: boolean; // "token expired" message already sent
  upload: UploadSession; // assignment submission in progress
  worker_url: string; // https://<worker>.<subdomain>.workers.dev, written by the installer
  webhook_url: string; // webhook the Worker registered itself (setup.ts)
  setup_status: SetupStatus; // outcome of the last self-registration, read by the installer
  owner_id: number; // Telegram id of the owner, when not set by the OWNER_ID secret (bot/owner.ts)
  claim_code: string; // SHA-256 hex of the installer's one-time claim code
}

export interface UploadSession {
  courseId: number;
  cmid: number;
  assignId: number;
  files: { fileId: string; name: string; size: number }[];
}

export interface Subscription {
  courseId: number;
  snapshot: Snapshot | null;
  checkedAt: number | null;
}

const now = () => Math.floor(Date.now() / 1000);

export class Store {
  constructor(private readonly db: D1Database, private readonly tokenKey: string) {}

  // --- kv ---------------------------------------------------------------------------

  async get<K extends keyof KvValues>(key: K): Promise<KvValues[K] | null> {
    const row = await this.db.prepare("SELECT value FROM kv WHERE key = ?").bind(key).first<{ value: string }>();
    return row ? (JSON.parse(row.value) as KvValues[K]) : null;
  }

  /** Several keys in one query (each D1 round trip costs CPU on the free plan). */
  async getMany<K extends keyof KvValues>(...keys: K[]): Promise<{ [P in K]?: KvValues[P] }> {
    const { results } = await this.db.prepare(
      `SELECT key, value FROM kv WHERE key IN (${keys.map(() => "?").join(",")})`,
    ).bind(...keys).all<{ key: K; value: string }>();
    return Object.fromEntries(results.map((r) => [r.key, JSON.parse(r.value)])) as { [P in K]?: KvValues[P] };
  }

  /**
   * Record a Telegram update id; false if it (or a later one) was already processed.
   * One atomic statement: Telegram re-sends updates when the webhook was slow, and this dedupes them.
   */
  async claimUpdate(updateId: number): Promise<boolean> {
    const res = await this.db.prepare(
      "INSERT INTO kv (key, value, updated_at) VALUES ('last_update_id', ?1, ?2) " +
      "ON CONFLICT(key) DO UPDATE SET value = ?1, updated_at = ?2 WHERE CAST(kv.value AS INTEGER) < ?3",
    ).bind(JSON.stringify(updateId), now(), updateId).run();
    return res.meta.changes > 0;
  }

  async set<K extends keyof KvValues>(key: K, value: KvValues[K]): Promise<void> {
    await this.db.prepare(
      "INSERT INTO kv (key, value, updated_at) VALUES (?1, ?2, ?3) " +
      "ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3",
    ).bind(key, JSON.stringify(value), now()).run();
  }

  async delete(...keys: (keyof KvValues)[]): Promise<void> {
    await this.db.batch(keys.map((k) => this.db.prepare("DELETE FROM kv WHERE key = ?").bind(k)));
  }

  // --- Moodle token -------------------------------------------------------------------

  async getToken(): Promise<string | null> {
    const sealed = await this.get("moodle_token");
    return sealed ? decrypt(sealed, this.tokenKey) : null;
  }

  async setToken(token: string, userid: number): Promise<void> {
    await this.set("moodle_token", await encrypt(token, this.tokenKey));
    await this.set("moodle_userid", userid);
    await this.set("token_alerted", false);
  }

  // --- subscriptions ------------------------------------------------------------------

  /** Least recently checked first (never-checked first of all), so the poller's per-run fetch budget
   *  rotates fairly instead of always going to the same busy course. */
  async subscriptions(): Promise<Subscription[]> {
    const { results } = await this.db.prepare(
      "SELECT course_id, snapshot, checked_at FROM subscriptions ORDER BY checked_at IS NOT NULL, checked_at",
    ).all<{ course_id: number; snapshot: string | null; checked_at: number | null }>();
    return results.map((r) => ({
      courseId: r.course_id,
      snapshot: r.snapshot ? (JSON.parse(r.snapshot) as Snapshot) : null,
      checkedAt: r.checked_at,
    }));
  }

  async isSubscribed(courseId: number): Promise<boolean> {
    return !!(await this.db.prepare("SELECT 1 FROM subscriptions WHERE course_id = ?").bind(courseId).first());
  }

  /** Toggle notifications for a course. Returns the new state. */
  async toggleSubscription(courseId: number): Promise<boolean> {
    if (await this.isSubscribed(courseId)) {
      await this.db.prepare("DELETE FROM subscriptions WHERE course_id = ?").bind(courseId).run();
      return false;
    }
    await this.db.prepare("INSERT INTO subscriptions (course_id) VALUES (?)").bind(courseId).run();
    return true;
  }

  async saveSnapshot(courseId: number, snapshot: Snapshot, checkedAt: number): Promise<void> {
    await this.db.prepare("UPDATE subscriptions SET snapshot = ?, checked_at = ? WHERE course_id = ?")
      .bind(JSON.stringify(snapshot), checkedAt, courseId).run();
  }

  async touchSubscription(courseId: number, checkedAt: number): Promise<void> {
    await this.db.prepare("UPDATE subscriptions SET checked_at = ? WHERE course_id = ?")
      .bind(checkedAt, courseId).run();
  }

  // --- reminders ----------------------------------------------------------------------

  async reminderSent(key: string): Promise<boolean> {
    return !!(await this.db.prepare("SELECT 1 FROM sent_reminders WHERE key = ?").bind(key).first());
  }

  async markReminder(key: string): Promise<void> {
    await this.db.prepare("INSERT OR IGNORE INTO sent_reminders (key, sent_at) VALUES (?, ?)")
      .bind(key, now()).run();
  }

  /** Forget reminders older than `days` (their deadlines have passed). */
  async pruneReminders(days = 30): Promise<void> {
    await this.db.prepare("DELETE FROM sent_reminders WHERE sent_at < ?").bind(now() - days * 86400).run();
  }
}

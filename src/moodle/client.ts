// Client for the Moodle mobile web service (the API the official Moodle app uses).
// All calls go through POST /webservice/rest/server.php with the user's token.

import type {
  ActionEvent, Assignment, Course, Discussion, PopupNotification, QrTokens, Section, SiteInfo,
  SubmissionStatus, UpdateInstance,
} from "./types";

// The site treats requests with the Moodle app user agent like the app (needed for QR login).
const APP_UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) MoodleMobile 4.5.0";
const TIMEOUT_MS = 25_000;
const READ_RETRIES = 2;
const RETRY_DELAY_MS = 1_500;

export class MoodleError extends Error {
  constructor(readonly code: string, message = "") {
    super(`${code}: ${message}`);
  }
}

/** Token missing, expired or revoked: the user has to log in again. */
export class TokenInvalid extends MoodleError {}

type Params = Record<string, unknown>;

/** Turn nested objects/arrays into PHP-style form keys: a[0][b]=1. */
export function flatten(params: Params, prefix = ""): [string, string][] {
  const out: [string, string][] = [];
  for (const [key, value] of Object.entries(params)) {
    const name = prefix ? `${prefix}[${key}]` : key;
    if (value === null || value === undefined) continue;
    if (typeof value === "object") out.push(...flatten(value as Params, name));
    else if (typeof value === "boolean") out.push([name, value ? "1" : "0"]);
    else out.push([name, String(value)]);
  }
  return out;
}

function raise(code: string, message = ""): never {
  throw code === "invalidtoken" ? new TokenInvalid(code, message) : new MoodleError(code, message);
}

export class Moodle {
  constructor(readonly base: string, private readonly token: string | null) {}

  private requireToken(): string {
    return this.token ?? raise("invalidtoken", "no token configured");
  }

  /**
   * fetch with timeout. Network errors and 5xx are retried `retries` times: the site often has short hiccups.
   * Only pass retries > 0 for requests that are safe to repeat (reads), never for submissions.
   */
  private async request(url: string, init: RequestInit = {}, retries = 0): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("User-Agent", APP_UA);
    for (let attempt = 0; ; attempt++) {
      try {
        const resp = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (resp.ok) return resp;
        if (resp.status < 500 || attempt >= retries) raise("http", `HTTP ${resp.status}`);
      } catch (err) {
        if (err instanceof MoodleError) throw err;
        if (attempt >= retries) throw new MoodleError("network", String(err));
      }
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
    }
  }

  /** Call a web-service function. Reads are retried on network errors; writes pass `{ retries: 0 }`. */
  async call<T>(fn: string, params: Params = {}, { retries = READ_RETRIES } = {}): Promise<T> {
    const body = new URLSearchParams([
      ["wstoken", this.requireToken()],
      ["wsfunction", fn],
      ["moodlewsrestformat", "json"],
      ...flatten(params),
    ]);
    const resp = await this.request(`${this.base}/webservice/rest/server.php`, { method: "POST", body }, retries);
    const data = (await resp.json()) as T & { exception?: string; errorcode?: string; message?: string };
    if (data && typeof data === "object" && "exception" in data) raise(data.errorcode ?? "unknown", data.message);
    return data;
  }

  // --- read -------------------------------------------------------------------------

  siteInfo = () => this.call<SiteInfo>("core_webservice_get_site_info");

  courses = (userid: number) => this.call<Course[]>("core_enrol_get_users_courses", { userid });

  contents = (courseid: number) => this.call<Section[]>("core_course_get_contents", { courseid });

  async assignments(courseid: number): Promise<Assignment[]> {
    const res = await this.call<{ courses: { assignments: Assignment[] }[] }>(
      "mod_assign_get_assignments", { courseids: [courseid] });
    return res.courses.flatMap((c) => c.assignments);
  }

  submissionStatus = (assignid: number) =>
    this.call<SubmissionStatus>("mod_assign_get_submission_status", { assignid });

  async forumDiscussions(forumid: number, perpage = 8): Promise<Discussion[]> {
    const res = await this.call<{ discussions: Discussion[] }>(
      "mod_forum_get_forum_discussions", { forumid, sortorder: -1, page: 0, perpage });
    return res.discussions;
  }

  /** Cheap change check: which activities of a course changed since `since` (unix time). */
  async updatesSince(courseid: number, since: number): Promise<UpdateInstance[]> {
    const res = await this.call<{ instances: UpdateInstance[] }>(
      "core_course_get_updates_since", { courseid, since });
    return res.instances;
  }

  async notifications(userid: number, limit = 20): Promise<PopupNotification[]> {
    const res = await this.call<{ notifications: PopupNotification[] }>(
      "message_popup_get_popup_notifications", { useridto: userid, newestfirst: 1, limit, offset: 0 });
    return res.notifications;
  }

  async actionEvents(timesortfrom: number, limit = 50): Promise<ActionEvent[]> {
    const res = await this.call<{ events: ActionEvent[] }>(
      "core_calendar_get_action_events_by_timesort", { timesortfrom, limitnum: limit });
    return res.events;
  }

  // --- files ------------------------------------------------------------------------

  /** Download a pluginfile URL from contents/attachments. Returns the response so the body can be streamed. */
  async download(fileurl: string): Promise<Response> {
    const url = new URL(fileurl.includes("/webservice/pluginfile.php")
      ? fileurl : fileurl.replace("/pluginfile.php", "/webservice/pluginfile.php"));
    url.searchParams.set("token", this.requireToken());
    const resp = await this.request(url.toString(), {}, READ_RETRIES);
    // Errors come back as JSON with HTTP 200.
    if (resp.headers.get("content-type")?.startsWith("application/json")) {
      const err = (await resp.json()) as { errorcode?: string; error?: string };
      raise(err.errorcode ?? "download", err.error);
    }
    return resp;
  }

  /** Upload files into a new draft area and return its itemid (used by save_submission). */
  async uploadDraft(files: { name: string; data: Blob }[]): Promise<number> {
    const form = new FormData();
    form.set("token", this.requireToken());
    form.set("filearea", "draft");
    form.set("itemid", "0");
    files.forEach((f, i) => form.set(`file_${i + 1}`, f.data, f.name));
    const resp = await this.request(`${this.base}/webservice/upload.php`, { method: "POST", body: form });
    const body = (await resp.json()) as { itemid: number }[] | { errorcode?: string; error?: string };
    if (!Array.isArray(body)) raise(body.errorcode ?? "upload", body.error);
    return body[0]!.itemid;
  }

  // --- write ------------------------------------------------------------------------

  async saveSubmission(assignmentid: number, draftItemId: number): Promise<void> {
    const warnings = await this.call<{ message: string }[]>(
      "mod_assign_save_submission", { assignmentid, plugindata: { files_filemanager: draftItemId } }, { retries: 0 });
    if (warnings.length) raise("savesubmission", warnings.map((w) => w.message).join("; "));
  }

  async submitForGrading(assignmentid: number): Promise<void> {
    const warnings = await this.call<{ message: string }[]>(
      "mod_assign_submit_for_grading", { assignmentid, acceptsubmissionstatement: 1 }, { retries: 0 });
    if (warnings.length) raise("submitforgrading", warnings.map((w) => w.message).join("; "));
  }

  // --- login ------------------------------------------------------------------------

  /** Exchange the profile-page QR key for a token. Needs no existing token. */
  async qrLogin(qrloginkey: string, userid: number): Promise<QrTokens> {
    const url = `${this.base}/lib/ajax/service-nologin.php?info=tool_mobile_get_tokens_for_qr_login`;
    const payload = [{ index: 0, methodname: "tool_mobile_get_tokens_for_qr_login", args: { qrloginkey, userid } }];
    const resp = await this.request(url, {
      method: "POST", body: JSON.stringify(payload), headers: { "content-type": "application/json" },
    });
    const [res] = (await resp.json()) as { error?: boolean; exception?: { errorcode?: string; message?: string };
      data?: QrTokens }[];
    if (!res || res.error || !res.data) raise(res?.exception?.errorcode ?? "qrlogin", res?.exception?.message);
    return res.data;
  }
}

/** Parse the text inside the profile-page login QR:
 *  moodlemobile://https://courses.aut.ac.ir?qrlogin=KEY&userid=ID */
export function parseLoginQr(text: string): { key: string; userid: number } | null {
  const key = /[?&]qrlogin=([^&\s]+)/.exec(text)?.[1];
  const userid = /[?&]userid=(\d+)/.exec(text)?.[1];
  return key && userid ? { key, userid: Number(userid) } : null;
}

/** Value of a setting in an assignment's `configs`, e.g. ("file", "maxfilesubmissions"). */
export function assignConfig(assign: Assignment, plugin: string, name: string): string | undefined {
  return assign.configs.find((c) => c.plugin === plugin && c.name === name)?.value;
}

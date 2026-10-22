import { afterEach, describe, expect, it, vi } from "vitest";
import { Moodle, MoodleError, TokenInvalid } from "../src/moodle/client";

const ok = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

function stubFetch(...responses: (Response | Error)[]) {
  const fetch = vi.fn(async () => {
    const next = responses.shift();
    if (!next || next instanceof Error) throw next ?? new Error("no more responses");
    return next;
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Moodle client retries", () => {
  const moodle = new Moodle("https://courses.example", "token");

  it("retries reads after a network error", async () => {
    vi.useFakeTimers();
    const fetch = stubFetch(new TypeError("connection reset"), ok({ userid: 1, fullname: "x", release: "5" }));
    const pending = moodle.siteInfo();
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ userid: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("gives up after the retry budget with a network error", async () => {
    vi.useFakeTimers();
    const fetch = stubFetch(new TypeError("a"), new TypeError("b"), new TypeError("c"));
    const pending = moodle.siteInfo().catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ code: "network" });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("never retries a submission", async () => {
    const fetch = stubFetch(new TypeError("connection reset"), ok([]));
    await expect(moodle.submitForGrading(5)).rejects.toBeInstanceOf(MoodleError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("maps invalidtoken to TokenInvalid without retrying", async () => {
    const fetch = stubFetch(ok({ exception: "moodle_exception", errorcode: "invalidtoken", message: "bad" }));
    await expect(moodle.siteInfo()).rejects.toBeInstanceOf(TokenInvalid);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

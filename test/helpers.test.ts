import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "../src/crypto";
import { flatten, parseLoginQr } from "../src/moodle/client";
import { currentTerm, termCode } from "../src/bot/handlers/courses";
import { cmidFromUrl } from "../src/bot/handlers/menu";
import { esc, fa, fmtLeft, fmtSize, fmtTime, stripHtml } from "../src/telegram/format";
import type { Course } from "../src/moodle/types";

describe("moodle helpers", () => {
  it("flattens nested params PHP-style", () => {
    expect(flatten({ courseids: [5, 6], plugindata: { files_filemanager: 9 }, flag: true, skip: undefined }))
      .toEqual([["courseids[0]", "5"], ["courseids[1]", "6"], ["plugindata[files_filemanager]", "9"], ["flag", "1"]]);
  });

  it("parses the login QR text in either parameter order", () => {
    expect(parseLoginQr("moodlemobile://https://courses.aut.ac.ir?qrlogin=abc123&userid=4242"))
      .toEqual({ key: "abc123", userid: 4242 });
    expect(parseLoginQr("https://courses.aut.ac.ir?userid=7&qrlogin=k")).toEqual({ key: "k", userid: 7 });
    expect(parseLoginQr("hello")).toBeNull();
  });

  it("extracts cmid from activity URLs", () => {
    expect(cmidFromUrl("https://courses.aut.ac.ir/mod/assign/view.php?id=1234")).toBe(1234);
    expect(cmidFromUrl(undefined)).toBeNull();
  });
});

describe("terms", () => {
  const course = (shortname: string) => ({ id: 1, shortname, fullname: "x" }) as Course;

  it("reads the term code from shortnames, old and new style", () => {
    expect(termCode("4051 - 2519063 - ریاضی(1)")).toBe("4051");
    expect(termCode("14041 - 123 - x")).toBe("4041");
    expect(termCode("Orientation")).toBe("0");
  });

  it("picks the newest term", () => {
    expect(currentTerm([course("4042 - 1 - a"), course("4051 - 2 - b"), course("14041 - 3 - c")])).toBe("4051");
  });
});

describe("format", () => {
  it("converts digits and escapes HTML", () => {
    expect(fa("ترم 4051")).toBe("ترم ۴۰۵۱");
    expect(esc("<b>&</b>")).toBe("&lt;b&gt;&amp;&lt;/b&gt;");
  });

  it("formats sizes and remaining time", () => {
    expect(fmtSize(512)).toBe("۵۱۲ B");
    expect(fmtSize(1536 * 1024)).toBe("۱.۵ MB");
    expect(fmtLeft(1000 + 2 * 86400 + 3 * 3600, 1000)).toBe("⏳ ۲ روز و ۳ ساعت مانده");
    expect(fmtLeft(999, 1000)).toBe("⛔️ مهلت گذشته");
  });

  it("formats Jalali dates in Tehran time", () => {
    // 2026-10-25 11:00 UTC = 14:30 Tehran, 3 Aban 1405 (Sunday)
    const text = fmtTime(Date.UTC(2026, 9, 25, 11, 0) / 1000);
    expect(text).toContain("۱۴۰۵");
    expect(text).toContain("آبان");
    expect(text).toContain("۱۴:۳۰");
  });

  it("strips Moodle HTML", () => {
    expect(stripHtml("<p>سلام&nbsp;<b>دنیا</b></p><p>&#1575;&amp;</p>")).toBe("سلام دنیا\nا&");
    expect(stripHtml("abcdef", 3)).toBe("abc…");
  });
});

describe("crypto", () => {
  const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

  it("round-trips and uses a fresh IV each time", async () => {
    const a = await encrypt("0123456789abcdef0123456789abcdef", key);
    const b = await encrypt("0123456789abcdef0123456789abcdef", key);
    expect(a).not.toBe(b);
    expect(await decrypt(a, key)).toBe("0123456789abcdef0123456789abcdef");
  });

  it("rejects a wrong key", async () => {
    const other = btoa(String.fromCharCode(...new Uint8Array(32)));
    await expect(decrypt(await encrypt("secret", key), other)).rejects.toThrow();
  });
});

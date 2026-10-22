import { describe, expect, it } from "vitest";
import { qrLoginErrorText } from "../src/bot/texts";
import { deployErrorHelp } from "../tools/lib.mjs";
import { inputHelp, parseQrInput, qrErrorHelp } from "../tools/qr.mjs";

const QR = "moodlemobile://https://courses.aut.ac.ir?qrlogin=a1b2c3d4&userid=4242";

describe("qr-token input", () => {
  it("accepts a real QR text, also quoted or with spaces", () => {
    expect(parseQrInput(QR)).toEqual({ key: "a1b2c3d4", userid: 4242 });
    expect(parseQrInput(`  "${QR}"\n`)).toEqual({ key: "a1b2c3d4", userid: 4242 });
  });

  it("recognises the docs example and other bad input", () => {
    expect(parseQrInput("moodlemobile://https://courses.aut.ac.ir?qrlogin=YOUR_KEY&userid=YOUR_ID").error)
      .toBe("placeholder");
    expect(parseQrInput("moodlemobile://https://courses.aut.ac.ir?qrlogin=KEY&userid=ID").error).toBe("placeholder");
    expect(parseQrInput("<FRESH_QR_TEXT>").error).toBe("placeholder");
    expect(parseQrInput("").error).toBe("empty");
    expect(parseQrInput("moodlemobile://https://other.site?qrlogin=a&userid=1").error).toBe("site");
    expect(parseQrInput("moodlemobile://https://courses.aut.ac.ir?qrlogin=a1b2").error).toBe("format");
    for (const e of ["empty", "placeholder", "site", "format"]) expect(inputHelp(e)).toBeTruthy();
  });

  it("explains each QR error differently", () => {
    const texts = ["expiredkey", "ipmismatch", "network", "badresponse", "whatever"].map(qrErrorHelp);
    expect(new Set(texts).size).toBe(texts.length);
    expect(qrErrorHelp("expiredkey")).toContain("QR تازه");
  });

  it("points every QR refusal to an expired courses session, the most common cause", () => {
    for (const code of ["expiredkey", "invalidkey", "ipmismatch", "whatever"]) {
      expect(qrErrorHelp(code)).toContain("رفرش");
    }
  });
});

describe("bot QR login errors", () => {
  it("leads ipmismatch to the local tool and doesn't suggest resending the same QR", () => {
    const text = qrLoginErrorText("ipmismatch");
    expect(text).toContain("install.cmd");
    expect(text).toContain("QR تازه");
  });

  it("tells expired keys to make a new QR", () => {
    expect(qrLoginErrorText("expiredkey")).toContain("QR تازه");
  });

  it("escapes unknown codes", () => {
    expect(qrLoginErrorText("<b>")).toContain("&lt;b&gt;");
  });
});

describe("setup errors", () => {
  it("explains a missing workers.dev subdomain", () => {
    const out = "[WARNING] You need to register a workers.dev subdomain before publishing to workers.dev";
    expect(deployErrorHelp(out)).toContain("dash.cloudflare.com");
    expect(deployErrorHelp("Timed out waiting for authorization code")).toContain("Allow");
  });

  it("returns null for unknown failures", () => {
    expect(deployErrorHelp("something else")).toBeNull();
  });
});

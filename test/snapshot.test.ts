import { describe, expect, it } from "vitest";
import { diffSnapshots, takeSnapshot } from "../src/poller/snapshot";
import type { Section } from "../src/moodle/types";

const file = (filename: string, timemodified: number) =>
  ({ type: "file" as const, filename, filepath: "/", fileurl: `https://x/${filename}`, timemodified });

const sections = (files: ReturnType<typeof file>[], extra = false): Section[] => [{
  id: 1, name: "هفته اول", modules: [
    { id: 10, instance: 1, name: "اسلاید", modname: "resource", contents: files },
    { id: 11, instance: 2, name: "مخفی", modname: "resource", uservisible: false },
    ...(extra ? [{ id: 12, instance: 3, name: "تمرین ۱", modname: "assign" }] : []),
  ],
}];

describe("takeSnapshot", () => {
  it("records visible modules and their files", () => {
    const snap = takeSnapshot(sections([file("a.pdf", 100)]));
    expect(Object.keys(snap)).toEqual(["10"]);
    expect(snap["10"]).toEqual({ name: "اسلاید", mod: "resource", section: "هفته اول", files: { "/a.pdf": 100 } });
  });
});

describe("diffSnapshots", () => {
  const before = takeSnapshot(sections([file("a.pdf", 100)]));

  it("reports nothing when unchanged", () => {
    expect(diffSnapshots(before, takeSnapshot(sections([file("a.pdf", 100)])))).toEqual([]);
  });

  it("reports new activities", () => {
    const changes = diffSnapshots(before, takeSnapshot(sections([file("a.pdf", 100)], true)));
    expect(changes).toMatchObject([{ cmid: 12, kind: "new", files: [] }]);
  });

  it("reports new and updated files, but not removed ones", () => {
    const after = takeSnapshot(sections([file("a.pdf", 200), file("b.pdf", 50)]));
    expect(diffSnapshots(before, after)).toMatchObject([{ cmid: 10, kind: "files", files: ["a.pdf", "b.pdf"] }]);
    expect(diffSnapshots(after, before)).toEqual([]);
  });
});

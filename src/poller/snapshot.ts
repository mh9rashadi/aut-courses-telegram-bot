// Compact record of a course's visible activities/files, and the diff between two records.
// Pure functions (no I/O) so they are unit-tested in test/snapshot.test.ts.

import type { Section } from "../moodle/types";

export interface ModuleSnapshot {
  name: string;
  mod: string; // modname
  section: string;
  files: Record<string, number>; // "<filepath><filename>" -> timemodified
}

/** cmid (as string) -> module. */
export type Snapshot = Record<string, ModuleSnapshot>;

export interface Change {
  cmid: number;
  kind: "new" | "files";
  module: ModuleSnapshot;
  files: string[]; // new or updated file names (for "new": all files)
}

export function takeSnapshot(sections: Section[]): Snapshot {
  const snap: Snapshot = {};
  for (const sec of sections) {
    for (const mod of sec.modules ?? []) {
      if (mod.uservisible === false) continue;
      const files: Record<string, number> = {};
      for (const c of mod.contents ?? []) {
        if (c.type === "file") files[`${c.filepath ?? "/"}${c.filename}`] = c.timemodified ?? 0;
      }
      snap[String(mod.id)] = { name: mod.name, mod: mod.modname, section: sec.name ?? "", files };
    }
  }
  return snap;
}

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** New activities, and new/updated files in existing ones. Removals are ignored on purpose. */
export function diffSnapshots(before: Snapshot, after: Snapshot): Change[] {
  const changes: Change[] = [];
  for (const [cmid, mod] of Object.entries(after)) {
    const old = before[cmid];
    if (!old) {
      changes.push({ cmid: Number(cmid), kind: "new", module: mod, files: Object.keys(mod.files).map(baseName) });
      continue;
    }
    const changed = Object.entries(mod.files)
      .filter(([path, time]) => old.files[path] === undefined || old.files[path]! < time)
      .map(([path]) => baseName(path));
    if (changed.length) changes.push({ cmid: Number(cmid), kind: "files", module: mod, files: changed });
  }
  return changes;
}

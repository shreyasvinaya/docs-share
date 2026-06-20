import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertWithinReadCap,
  collectFiles,
  enforceUploadLimits,
  type FileEntry,
} from "./push.js";

let root: string;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

function makeTree(): string {
  const dir = mkdtempSync(join(tmpdir(), "ds-cli-push-"));
  // Regular files
  writeFileSync(join(dir, "a.md"), "alpha");
  writeFileSync(join(dir, "b.txt"), "bravo");
  // Dotfile (should be skipped)
  writeFileSync(join(dir, ".secret"), "x");
  // Nested directory with a file
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "sub", "c.md"), "charlie");
  // node_modules (should be skipped entirely)
  mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "pkg", "index.js"), "junk");
  // .git (should be skipped entirely)
  mkdirSync(join(dir, ".git"));
  writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/main");
  return dir;
}

describe("push collectFiles", () => {
  test("skips dotfiles, node_modules, and .git", () => {
    root = makeTree();
    const { files } = collectFiles(root, true);
    const names = files.map((f) => f.relativeName).sort();

    expect(names).toEqual(["a.md", "b.txt", join("sub", "c.md")].sort());
    expect(names.some((n) => n.includes("node_modules"))).toBe(false);
    expect(names.some((n) => n.includes(".git"))).toBe(false);
    expect(names.some((n) => n.includes(".secret"))).toBe(false);
  });

  test("records file sizes", () => {
    root = makeTree();
    const { files } = collectFiles(root, true);
    const a = files.find((f) => f.relativeName === "a.md");
    expect(a?.sizeBytes).toBe("alpha".length);
  });

  test("handles a single file (non-directory)", () => {
    root = mkdtempSync(join(tmpdir(), "ds-cli-push-single-"));
    const filePath = join(root, "only.md");
    writeFileSync(filePath, "hello");
    const { files } = collectFiles(filePath, false);
    expect(files).toHaveLength(1);
    expect(files[0].relativeName).toBe("only.md");
    expect(files[0].sizeBytes).toBe("hello".length);
  });
});

describe("push collectFiles symlink handling (M3)", () => {
  test("skips symlinked files and dirs and counts them", () => {
    root = mkdtempSync(join(tmpdir(), "ds-cli-push-symlink-"));
    writeFileSync(join(root, "real.md"), "real");

    // A symlinked file pointing at the real one.
    symlinkSync(join(root, "real.md"), join(root, "link.md"));

    // A symlinked directory pointing elsewhere in the tree.
    mkdirSync(join(root, "realdir"));
    writeFileSync(join(root, "realdir", "inner.md"), "inner");
    symlinkSync(join(root, "realdir"), join(root, "linkdir"));

    const { files, skippedSymlinks } = collectFiles(root, true);
    const names = files.map((f) => f.relativeName).sort();

    // Only the real file and the real dir's file are uploaded.
    expect(names).toEqual(["real.md", join("realdir", "inner.md")].sort());
    // Both the symlinked file and the symlinked dir are counted.
    expect(skippedSymlinks).toBe(2);
  });

  test("no symlinks means skippedSymlinks is 0", () => {
    root = makeTree();
    const { skippedSymlinks } = collectFiles(root, true);
    expect(skippedSymlinks).toBe(0);
  });
});

describe("push enforceUploadLimits", () => {
  const sample: FileEntry[] = [
    { absolutePath: "/a", relativeName: "a", sizeBytes: 10 },
    { absolutePath: "/b", relativeName: "b", sizeBytes: 20 },
  ];

  test("passes when under both limits", () => {
    expect(() => enforceUploadLimits(sample, 10, 1000)).not.toThrow();
  });

  test("throws a clear error when file count exceeds the limit", () => {
    expect(() => enforceUploadLimits(sample, 1, 1000)).toThrow(
      /Refusing to upload 2 files \(limit 1\)/
    );
    expect(() => enforceUploadLimits(sample, 1, 1000)).toThrow(
      /PATRA_MAX_UPLOAD_FILES/
    );
  });

  test("throws a clear error when total size exceeds the limit", () => {
    expect(() => enforceUploadLimits(sample, 10, 25)).toThrow(/Refusing to upload/);
    expect(() => enforceUploadLimits(sample, 10, 25)).toThrow(
      /PATRA_MAX_UPLOAD_BYTES/
    );
  });
});

describe("push assertWithinReadCap (M4 in-loop re-check)", () => {
  test("passes when the running total is at or under the cap", () => {
    expect(() => assertWithinReadCap(0, 100)).not.toThrow();
    expect(() => assertWithinReadCap(100, 100)).not.toThrow();
  });

  test("throws when the running total exceeds the cap (a file grew)", () => {
    expect(() => assertWithinReadCap(101, 100)).toThrow(/exceeded/);
    expect(() => assertWithinReadCap(101, 100)).toThrow(/changed or grew/);
    expect(() => assertWithinReadCap(101, 100)).toThrow(/PATRA_MAX_UPLOAD_BYTES/);
  });
});

describe("push collectFiles stat-failure handling (M4)", () => {
  test("a broken symlink (dangling target) is skipped as a symlink, not a stat-failure", () => {
    // A dangling symlink is still detected as a symlink by isSymbolicLink(), so
    // it's counted as a skipped symlink and never stat'd as a real file.
    root = mkdtempSync(join(tmpdir(), "ds-cli-push-dangling-"));
    writeFileSync(join(root, "real.md"), "x");
    const { files, skippedSymlinks, statFailures } = collectFiles(root, true);
    expect(files.map((f) => f.relativeName)).toEqual(["real.md"]);
    expect(skippedSymlinks).toBe(0);
    expect(statFailures).toEqual([]);
  });

  test("a single missing file reports a stat failure rather than size 0", () => {
    const missing = join(tmpdir(), "ds-cli-definitely-missing-xyz.md");
    const { files, statFailures } = collectFiles(missing, false);
    expect(files).toHaveLength(0);
    expect(statFailures).toContain(missing);
  });
});

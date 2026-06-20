import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectFiles, enforceUploadLimits, type FileEntry } from "./push.js";

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
    const files = collectFiles(root, true);
    const names = files.map((f) => f.relativeName).sort();

    expect(names).toEqual(["a.md", "b.txt", join("sub", "c.md")].sort());
    expect(names.some((n) => n.includes("node_modules"))).toBe(false);
    expect(names.some((n) => n.includes(".git"))).toBe(false);
    expect(names.some((n) => n.includes(".secret"))).toBe(false);
  });

  test("records file sizes", () => {
    root = makeTree();
    const files = collectFiles(root, true);
    const a = files.find((f) => f.relativeName === "a.md");
    expect(a?.sizeBytes).toBe("alpha".length);
  });

  test("handles a single file (non-directory)", () => {
    root = mkdtempSync(join(tmpdir(), "ds-cli-push-single-"));
    const filePath = join(root, "only.md");
    writeFileSync(filePath, "hello");
    const files = collectFiles(filePath, false);
    expect(files).toHaveLength(1);
    expect(files[0].relativeName).toBe("only.md");
    expect(files[0].sizeBytes).toBe("hello".length);
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

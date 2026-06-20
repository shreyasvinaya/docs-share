import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("favicon", () => {
  test("is declared in the HTML shell and served from public assets", () => {
    const root = resolve(import.meta.dir, "../..");
    const html = readFileSync(resolve(root, "index.html"), "utf8");

    expect(html).toContain('rel="icon"');
    expect(html).toContain('href="/favicon.svg"');
    expect(existsSync(resolve(root, "public/favicon.svg"))).toBe(true);
  });
});

import { describe, expect, test } from "bun:test";
import {
  DRAFT_PATH_PREFIX,
  buildDraftShellHtml,
  buildDraftStoragePath,
  draftContentSecurityHeaders,
  extractDraftTitle,
  normalizeDraftFilename,
  validateDraftUpload,
} from "./drafts.js";

describe("draft helpers", () => {
  test("extracts a readable title from HTML", () => {
    expect(extractDraftTitle("<html><head><title> Launch Plan </title></head></html>")).toBe(
      "Launch Plan"
    );
    expect(extractDraftTitle("<h1>Fallback Heading</h1>")).toBe("Fallback Heading");
    expect(extractDraftTitle("<p>No heading</p>", "agent-plan.html")).toBe(
      "agent-plan"
    );
  });

  test("normalizes draft filenames to safe html names", () => {
    expect(normalizeDraftFilename("plan.html")).toBe("plan.html");
    expect(normalizeDraftFilename("../plan.html")).toBeNull();
    expect(normalizeDraftFilename("plan.txt")).toBeNull();
    expect(normalizeDraftFilename("")).toBeNull();
  });

  test("builds reserved storage paths under the draft prefix", () => {
    expect(DRAFT_PATH_PREFIX).toBe("_drafts");
    expect(buildDraftStoragePath("dr_123")).toBe("_drafts/dr_123/index.html");
  });

  test("validates html uploads and rejects oversized or non-html files", () => {
    const html = new TextEncoder().encode("<!doctype html><title>Ok</title>");
    expect(validateDraftUpload("plan.html", html.byteLength, "text/html")).toEqual({
      ok: true,
    });

    expect(validateDraftUpload("plan.txt", html.byteLength, "text/plain")).toEqual({
      ok: false,
      error: "Draft uploads must be .html or .htm files",
    });

    expect(validateDraftUpload("plan.html", 11 * 1024 * 1024, "text/html")).toEqual({
      ok: false,
      error: "Draft upload exceeds the 10 MB limit",
    });
  });

  test("builds a sandboxed draft shell without same-origin iframe access", () => {
    const html = buildDraftShellHtml({
      title: "Launch <Plan>",
      contentPath: "/draft-content/dr_123?exp=1&sig=abc",
    });

    expect(html).toContain("Postplan");
    expect(html).toContain("This is a hosted draft.");
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).not.toContain("allow-same-origin");
    expect(html).toContain("Launch &lt;Plan&gt;");
  });

  test("sets CSP sandbox headers for draft content responses", () => {
    const headers = draftContentSecurityHeaders();

    expect(headers["Content-Security-Policy"]).toContain("sandbox allow-scripts");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Content-Type"]).toBe("text/html; charset=utf-8");
  });
});

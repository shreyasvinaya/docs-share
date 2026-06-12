import { describe, expect, test } from "bun:test";
import { collectDraftFile, formatDraftUploadResult } from "./draft-helpers.js";

describe("draft command helpers", () => {
  test("collects a single html draft file", () => {
    const file = collectDraftFile("plan.html", new Uint8Array([1, 2, 3]));

    expect(file.fileName).toBe("plan.html");
    expect(file.sizeBytes).toBe(3);
  });

  test("rejects non-html draft files", () => {
    expect(() => collectDraftFile("plan.txt", new Uint8Array())).toThrow(
      "Draft uploads must be .html or .htm files"
    );
  });

  test("formats URL-first output by default and JSON when requested", () => {
    const result = {
      id: "dr_123",
      url: "https://example.com/d/dr_123",
      title: "Launch Plan",
      createdAt: "2026-06-13T00:00:00.000Z",
    };

    expect(formatDraftUploadResult(result, "text")).toBe(result.url);
    expect(formatDraftUploadResult(result, "text").split("\n")[0]).toBe(result.url);
    expect(formatDraftUploadResult(result, "json")).toBe(
      JSON.stringify(result, null, 2)
    );
  });
});

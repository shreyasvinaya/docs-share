import { describe, expect, test } from "bun:test";
import { formatLastOpened, formatViewSummary } from "./view-analytics";

describe("formatLastOpened", () => {
  test("returns a never-opened label for null", () => {
    expect(formatLastOpened(null)).toBe("Never opened");
  });

  test("renders a localized date for a timestamp", () => {
    const out = formatLastOpened("2026-01-15T10:00:00.000Z");
    expect(out).not.toBe("Never opened");
    expect(out.length).toBeGreaterThan(0);
  });
});

describe("formatViewSummary", () => {
  test("pluralizes views and unique visitors", () => {
    expect(formatViewSummary({ totalViews: 1, uniqueVisitors: 1 })).toBe(
      "1 view · 1 visitor"
    );
    expect(formatViewSummary({ totalViews: 5, uniqueVisitors: 2 })).toBe(
      "5 views · 2 visitors"
    );
  });

  test("handles zero views", () => {
    expect(formatViewSummary({ totalViews: 0, uniqueVisitors: 0 })).toBe(
      "No views yet"
    );
  });
});

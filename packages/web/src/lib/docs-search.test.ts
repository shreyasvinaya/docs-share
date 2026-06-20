import { describe, expect, test } from "bun:test";
import {
  buildDocsSearchIndex,
  searchDocs,
  slugifyHeading,
  type DocsSearchGuide,
} from "./docs-search";

const guides: DocsSearchGuide[] = [
  {
    slug: "api-reference",
    title: "API Reference",
    content: [
      "# API Reference",
      "",
      "The complete contract lives at `GET /openapi.json`.",
      "",
      "## Drafts",
      "",
      "Drafts publish a single static HTML file to a private URL.",
      "Token scopes: `draft:read` and `draft:write`.",
      "",
      "## Shares",
      "",
      "Create a share with `POST /api/shares`.",
    ].join("\n"),
  },
  {
    slug: "product-guide",
    title: "Product Guide",
    content: [
      "# Product Guide",
      "",
      "## Teams",
      "",
      "Teams group users with roles owner, admin, member, and viewer.",
    ].join("\n"),
  },
];

describe("buildDocsSearchIndex", () => {
  test("splits guides into heading sections with anchors", () => {
    const index = buildDocsSearchIndex(guides);
    const headings = index.sections.map((s) => s.heading);
    expect(headings).toContain("Drafts");
    expect(headings).toContain("Shares");
    expect(headings).toContain("Teams");

    const drafts = index.sections.find((s) => s.heading === "Drafts");
    expect(drafts?.guideSlug).toBe("api-reference");
    expect(drafts?.anchor).toBe("drafts");
  });

  test("anchors match the renderer slugify behavior", () => {
    expect(slugifyHeading("GET /api/auth/session")).toBe("get-api-auth-session");
    expect(slugifyHeading("`POST` Drafts")).toBe("post-drafts");
  });
});

describe("searchDocs", () => {
  const index = buildDocsSearchIndex(guides);

  test("returns nothing for empty or too-short queries", () => {
    expect(searchDocs(index, "")).toEqual([]);
    expect(searchDocs(index, "a")).toEqual([]);
  });

  test("finds the section that mentions a term and links to its anchor", () => {
    const results = searchDocs(index, "draft");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].guideSlug).toBe("api-reference");
    expect(results[0].anchor).toBe("drafts");
    expect(results[0].snippet.toLowerCase()).toContain("draft");
  });

  test("boosts heading matches above body-only matches", () => {
    const results = searchDocs(index, "teams");
    expect(results[0].heading).toBe("Teams");
  });

  test("requires every query term to match (AND semantics)", () => {
    expect(searchDocs(index, "draft nonexistentword")).toEqual([]);
    expect(searchDocs(index, "share api").length).toBeGreaterThan(0);
  });

  test("respects the result limit", () => {
    expect(searchDocs(index, "a the and", 1).length).toBeLessThanOrEqual(1);
  });
});

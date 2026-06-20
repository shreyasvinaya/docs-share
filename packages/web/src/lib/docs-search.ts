/**
 * Dependency-light client-side full-text search over the Markdown guides shown
 * in the /docs UI. Each guide is split into sections by heading so a match can
 * jump to a specific anchor. Scoring is a simple term-frequency model with a
 * boost for matches in titles and headings.
 */

export interface DocsSearchGuide {
  slug: string;
  title: string;
  content: string;
}

interface DocsSection {
  guideSlug: string;
  guideTitle: string;
  /** Section heading text (or the guide title for the lead section). */
  heading: string;
  /** Anchor id for the heading, matching the renderer's slugify. */
  anchor: string;
  /** Lower-cased searchable text (heading + body). */
  haystack: string;
  /** Original body text for building snippets. */
  body: string;
}

export interface DocsSearchIndex {
  sections: DocsSection[];
}

export interface DocsSearchResult {
  guideSlug: string;
  guideTitle: string;
  heading: string;
  anchor: string;
  snippet: string;
  score: number;
}

/** Mirrors the heading slugify used by the Markdown renderer. */
export function slugifyHeading(value: string): string {
  return value
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Strip light Markdown inline syntax so snippets read as plain text. */
function stripInline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);
}

export function buildDocsSearchIndex(
  guides: readonly DocsSearchGuide[],
): DocsSearchIndex {
  const sections: DocsSection[] = [];

  for (const guide of guides) {
    const lines = guide.content.replace(/\r\n/g, "\n").split("\n");
    let heading = guide.title;
    let anchor = "";
    let body: string[] = [];
    let inCode = false;

    const flush = () => {
      const bodyText = stripInline(body.join(" ").replace(/\s+/g, " ")).trim();
      if (!bodyText && heading === guide.title) return;
      sections.push({
        guideSlug: guide.slug,
        guideTitle: guide.title,
        heading,
        anchor,
        haystack: `${heading} ${bodyText}`.toLowerCase(),
        body: bodyText,
      });
    };

    for (const line of lines) {
      if (line.startsWith("```")) {
        inCode = !inCode;
        continue;
      }
      const headingMatch = !inCode && line.match(/^(#{1,4})\s+(.+)$/);
      if (headingMatch) {
        flush();
        heading = stripInline(headingMatch[2]);
        anchor = slugifyHeading(headingMatch[2]);
        body = [];
        continue;
      }
      if (line.trim()) body.push(line.trim());
    }
    flush();
  }

  return { sections };
}

function buildSnippet(body: string, terms: string[]): string {
  const lower = body.toLowerCase();
  let index = -1;
  for (const term of terms) {
    const found = lower.indexOf(term);
    if (found !== -1 && (index === -1 || found < index)) index = found;
  }
  if (index === -1) return body.slice(0, 160).trim();

  const start = Math.max(0, index - 60);
  const end = Math.min(body.length, index + 100);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < body.length ? "…" : "";
  return `${prefix}${body.slice(start, end).trim()}${suffix}`;
}

export function searchDocs(
  index: DocsSearchIndex,
  query: string,
  limit = 12,
): DocsSearchResult[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [];

  const results: DocsSearchResult[] = [];

  for (const section of index.sections) {
    const headingLower = section.heading.toLowerCase();
    let score = 0;
    let matchedAll = true;

    for (const term of terms) {
      let occurrences = 0;
      let from = 0;
      while (true) {
        const found = section.haystack.indexOf(term, from);
        if (found === -1) break;
        occurrences += 1;
        from = found + term.length;
      }
      if (occurrences === 0) {
        matchedAll = false;
        break;
      }
      score += occurrences;
      if (headingLower.includes(term)) score += 5;
    }

    if (!matchedAll) continue;

    results.push({
      guideSlug: section.guideSlug,
      guideTitle: section.guideTitle,
      heading: section.heading,
      anchor: section.anchor,
      snippet: buildSnippet(section.body, terms),
      score,
    });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

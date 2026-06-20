import type { ReactNode } from "react";
import { Link, Navigate, useParams } from "react-router";
import { PublicAuthAction } from "@/components/layout/public-auth-action";
import { PublicThemeControl } from "@/components/layout/public-theme-control";
import { useDeploymentName } from "@/hooks/use-setup";
import deploymentDoc from "../../../../docs/deployment.md?raw";
import selfHostingDoc from "../../../../docs/self-hosting.md?raw";
import productGuideDoc from "../../../../docs/product-guide.md?raw";
import agentGuideDoc from "../../../../docs/agent-guide.md?raw";
import handoffDoc from "../../../../HANDOFF.md?raw";
import securityDoc from "../../../../SECURITY.md?raw";
import skillsDoc from "../../../../SKILLS.md?raw";

type MarkdownPart =
  | { type: "heading"; depth: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "metadata"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; language: string; text: string }
  | { type: "hr" }
  | { type: "table"; headers: string[]; rows: string[][] };

const guides = [
  {
    slug: "product-guide",
    title: "Product Guide",
    description: "Drafts, uploads, teams, sharing, previews, auth, examples, and operations.",
    content: productGuideDoc,
  },
  {
    slug: "agent-guide",
    title: "Agent Guide",
    description: "CLI/API workflows, source anchors, constraints, and common failure modes.",
    content: agentGuideDoc,
  },
  {
    slug: "agent-skills",
    title: "Agent Skills",
    description: "A quick guide for future coding agents working in this repository.",
    content: skillsDoc,
  },
  {
    slug: "deployment",
    title: "Deployment",
    description: "Production checklist plus Docker, Render, Fly.io, Railway, VPS, and Kubernetes notes.",
    content: deploymentDoc,
  },
  {
    slug: "self-hosting",
    title: "Self-Hosting",
    description: "Required settings, OAuth, persistent data, reverse proxy paths, and backups.",
    content: selfHostingDoc,
  },
  {
    slug: "handoff",
    title: "Engineering Handoff",
    description: "System architecture, feature status, operational notes, and current risks.",
    content: handoffDoc,
  },
  {
    slug: "security",
    title: "Security",
    description: "Security boundaries and production hardening notes.",
    content: securityDoc,
  },
] as const;

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function hrefForMarkdownLink(href: string) {
  const [path, hash] = href.replace(/^\.\//, "").split("#");
  const guide = guides.find((item) => {
    return (
      path === `${item.slug}.md` ||
      path.endsWith(`/${item.slug}.md`) ||
      (path === "SKILLS.md" && item.slug === "agent-skills") ||
      (path === "HANDOFF.md" && item.slug === "handoff") ||
      (path === "SECURITY.md" && item.slug === "security") ||
      (path.endsWith("deployment.md") && item.slug === "deployment") ||
      (path.endsWith("self-hosting.md") && item.slug === "self-hosting") ||
      (path.endsWith("product-guide.md") && item.slug === "product-guide") ||
      (path.endsWith("agent-guide.md") && item.slug === "agent-guide")
    );
  });

  if (!guide) return href;
  return `/docs/${guide.slug}${hash ? `#${hash}` : ""}`;
}

function labelForMarkdownLink(label: string, href: string) {
  if (!/\.md$/i.test(label.trim())) return label;

  const [path] = href.replace(/^\.\//, "").split("#");
  const guide = guides.find((item) => {
    return (
      path === `${item.slug}.md` ||
      path.endsWith(`/${item.slug}.md`) ||
      (path === "SKILLS.md" && item.slug === "agent-skills") ||
      (path === "HANDOFF.md" && item.slug === "handoff") ||
      (path === "SECURITY.md" && item.slug === "security") ||
      (path.endsWith("deployment.md") && item.slug === "deployment") ||
      (path.endsWith("self-hosting.md") && item.slug === "self-hosting") ||
      (path.endsWith("product-guide.md") && item.slug === "product-guide") ||
      (path.endsWith("agent-guide.md") && item.slug === "agent-guide")
    );
  });

  return guide?.title ?? label.replace(/\.md$/i, "");
}

function splitTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableDivider(line: string) {
  const cells = splitTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function inlineMarkdown(text: string) {
  const nodes: ReactNode[] = [];
  const pattern =
    /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > cursor) {
      nodes.push(text.slice(cursor, match.index));
    }

    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(
        <code
          key={`${match.index}-code`}
          className="rounded bg-muted px-1 py-0.5 text-xs text-foreground"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      nodes.push(
        <strong
          key={`${match.index}-strong`}
          className="font-semibold text-foreground"
        >
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("*")) {
      nodes.push(
        <em key={`${match.index}-em`} className="text-foreground">
          {token.slice(1, -1)}
        </em>,
      );
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        nodes.push(
          <Link
            key={`${match.index}-link`}
            to={hrefForMarkdownLink(linkMatch[2])}
            className="font-medium text-foreground underline underline-offset-4"
          >
            {labelForMarkdownLink(linkMatch[1], linkMatch[2])}
          </Link>,
        );
      }
    }
    cursor = pattern.lastIndex;
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes;
}

function parseMarkdown(markdown: string): MarkdownPart[] {
  const parts: MarkdownPart[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let ordered = false;
  let codeLines: string[] | null = null;
  let language = "";

  function nextContentLine(startIndex: number) {
    for (let index = startIndex; index < lines.length; index += 1) {
      if (lines[index].trim()) return lines[index];
    }
    return "";
  }

  function flushParagraph() {
    if (paragraph.length) {
      parts.push({ type: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
  }

  function flushList() {
    if (listItems.length) {
      parts.push({ type: "list", ordered, items: listItems });
      listItems = [];
      ordered = false;
    }
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];

    if (codeLines) {
      if (line.startsWith("```")) {
        const text = codeLines.join("\n");
        if (language || text.trim()) {
          parts.push({ type: "code", language, text });
        }
        codeLines = null;
        language = "";
      } else {
        codeLines.push(line);
      }
      continue;
    }

    if (line.startsWith("```")) {
      flushParagraph();
      flushList();
      codeLines = [];
      language = line.slice(3).trim();
      continue;
    }

    if (/^\s*---+\s*$/.test(line)) {
      flushParagraph();
      flushList();
      parts.push({ type: "hr" });
      continue;
    }

    const metadata = line.match(/^_Last updated:\s*(.+)_$/);
    if (metadata) {
      flushParagraph();
      flushList();
      parts.push({ type: "metadata", text: `Last updated: ${metadata[1]}` });
      continue;
    }

    if (line.includes("|") && isTableDivider(lines[lineIndex + 1] ?? "")) {
      flushParagraph();
      flushList();
      const headers = splitTableRow(line);
      const rows: string[][] = [];
      let rowIndex = lineIndex + 2;
      while (
        rowIndex < lines.length &&
        lines[rowIndex].includes("|") &&
        lines[rowIndex].trim()
      ) {
        rows.push(splitTableRow(lines[rowIndex]));
        rowIndex += 1;
      }
      parts.push({ type: "table", headers, rows });
      lineIndex = rowIndex - 1;
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      parts.push({
        type: "heading",
        depth: heading[1].length,
        text: heading[2],
      });
      continue;
    }

    const unordered = line.match(/^\s*-\s+(.+)$/);
    const numbered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (unordered || numbered) {
      flushParagraph();
      const nextOrdered = Boolean(numbered);
      if (listItems.length && ordered !== nextOrdered) flushList();
      ordered = nextOrdered;
      listItems.push((unordered?.[1] ?? numbered?.[1] ?? "").trim());
      continue;
    }

    if (/^\s+/.test(line) && listItems.length) {
      listItems[listItems.length - 1] += ` ${line.trim()}`;
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      if (listItems.length) {
        const nextLine = nextContentLine(lineIndex + 1);
        const nextIsList =
          /^\s*-\s+/.test(nextLine) || /^\s*\d+\.\s+/.test(nextLine);
        const nextIsContinuation =
          /^\s+\S/.test(nextLine) && !nextLine.startsWith("```");
        if (nextIsList || nextIsContinuation) continue;
      }
      flushList();
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  if (codeLines) {
    const text = codeLines.join("\n");
    if (language || text.trim()) {
      parts.push({ type: "code", language, text });
    }
  }

  return parts;
}

function MarkdownDoc({ markdown }: { markdown: string }) {
  return (
    <div className="space-y-5">
      {parseMarkdown(markdown).map((part, index) => {
        if (part.type === "heading") {
          const Heading = part.depth <= 1 ? "h2" : part.depth === 2 ? "h3" : "h4";
          const size =
            part.depth <= 1
              ? "text-3xl"
              : part.depth === 2
                ? "text-2xl"
                : "text-lg";
          return (
            <Heading
              key={`${part.text}-${index}`}
              id={slugify(part.text)}
              className={`scroll-mt-24 pt-4 font-semibold text-foreground ${size}`}
            >
              {inlineMarkdown(part.text)}
            </Heading>
          );
        }

        if (part.type === "list") {
          const List = part.ordered ? "ol" : "ul";
          return (
            <List
              key={`list-${index}`}
              className={`space-y-2 pl-6 text-sm leading-7 text-muted-foreground ${
                part.ordered ? "list-decimal" : "list-disc"
              }`}
            >
              {part.items.map((item) => (
                <li key={item}>{inlineMarkdown(item)}</li>
              ))}
            </List>
          );
        }

        if (part.type === "code") {
          return (
            <pre
              key={`code-${index}`}
              className="overflow-x-auto rounded-lg border border-border bg-muted p-4 text-sm text-foreground"
            >
              <code>{part.text}</code>
            </pre>
          );
        }

        if (part.type === "metadata") {
          return (
            <p key={`meta-${index}`} className="text-sm text-muted-foreground">
              {part.text}
            </p>
          );
        }

        if (part.type === "table") {
          return (
            <div
              key={`table-${index}`}
              className="overflow-x-auto rounded-lg border border-border"
            >
              <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                <thead className="bg-muted">
                  <tr>
                    {part.headers.map((header) => (
                      <th
                        key={header}
                        className="border-b border-border px-3 py-2 font-semibold text-foreground"
                      >
                        {inlineMarkdown(header)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {part.rows.map((row, rowIndex) => (
                    <tr
                      key={`${row.join("-")}-${rowIndex}`}
                      className="border-b border-border last:border-b-0"
                    >
                      {part.headers.map((header, cellIndex) => (
                        <td
                          key={`${header}-${cellIndex}`}
                          className="px-3 py-2 align-top text-muted-foreground"
                        >
                          {inlineMarkdown(row[cellIndex] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        if (part.type === "hr") {
          return <hr key={`hr-${index}`} className="border-border" />;
        }

        return (
          <p key={`p-${index}`} className="text-sm leading-7 text-muted-foreground">
            {inlineMarkdown(part.text)}
          </p>
        );
      })}
    </div>
  );
}

function PublicDocsLayout({ children }: { children: ReactNode }) {
  const deploymentName = useDeploymentName();

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link to="/" className="font-semibold">
            {deploymentName}
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link
              to="/"
              className="rounded-lg px-3 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Home
            </Link>
            <PublicThemeControl />
            <PublicAuthAction />
          </nav>
        </div>
      </header>
      {children}
    </main>
  );
}

function DocsIndexPage() {
  const deploymentName = useDeploymentName();

  return (
    <PublicDocsLayout>
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 py-12">
          <p className="mb-3 text-sm font-medium uppercase text-muted-foreground">
            Product docs
          </p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight">
            Run, use, and extend {deploymentName}.
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground">
            Choose a guide. Each guide is its own page, with normal headings,
            links, and code blocks.
          </p>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-5 py-12 md:grid-cols-2">
        {guides.map((guide) => (
          <Link
            key={guide.slug}
            to={`/docs/${guide.slug}`}
            className="rounded-lg border border-border p-5 transition-colors hover:bg-muted/50"
          >
            <h2 className="text-lg font-semibold">{guide.title}</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {guide.description}
            </p>
          </Link>
        ))}
      </section>
    </PublicDocsLayout>
  );
}

function GuidePage({ slug }: { slug: string }) {
  const guide = guides.find((item) => item.slug === slug);
  if (!guide) return <Navigate to="/docs" replace />;

  return (
    <PublicDocsLayout>
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 py-10">
          <Link
            to="/docs"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Docs
          </Link>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight">
            {guide.title}
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground">
            {guide.description}
          </p>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-8 px-5 py-10 lg:grid-cols-[220px_1fr]">
        <aside className="space-y-2">
          {guides.map((item) => (
            <Link
              key={item.slug}
              to={`/docs/${item.slug}`}
              className={`block rounded-lg border px-3 py-2 text-sm transition-colors ${
                item.slug === guide.slug
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {item.title}
            </Link>
          ))}
        </aside>
        <article className="min-w-0 rounded-lg border border-border p-6">
          <MarkdownDoc markdown={guide.content} />
        </article>
      </section>
    </PublicDocsLayout>
  );
}

export function PublicDocsPage() {
  const { guide } = useParams();
  if (!guide) return <DocsIndexPage />;
  return <GuidePage slug={guide} />;
}

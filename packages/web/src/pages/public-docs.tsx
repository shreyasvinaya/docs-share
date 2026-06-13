import { Link } from "react-router";
import type { ReactNode } from "react";
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
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; language: string; text: string };

const sections = [
  {
    title: "Quick start",
    items: [
      "Sign in with Google or dev login in local development.",
      "Create an API token in Settings when an agent or script needs to publish.",
      "Upload a single HTML draft with the CLI, or upload a folder when assets and links must stay together.",
      "Open the preview URL, then share it with a user, team, or link depending on the audience.",
    ],
  },
  {
    title: "Publishing modes",
    items: [
      "Draft publishing is optimized for one HTML file and returns a minimal hosted draft URL.",
      "Personal files are private to the signed-in user unless explicitly shared.",
      "Team files belong to the selected team workspace and can be reviewed by team members.",
      "Linked HTML sites should be uploaded as folders so CSS, images, and sibling pages keep their relative paths.",
    ],
  },
  {
    title: "Operations",
    items: [
      "Run the server with persistent storage for SQLite, bare Git repositories, extracted worktrees, drafts, and hooks.",
      "Use HTTPS and strong secrets in production.",
      "Configure CONTENT_ORIGIN separately when possible so untrusted HTML is isolated from the app origin.",
      "Back up the SQLite database, repositories, worktrees, drafts, and generated hook state together.",
    ],
  },
];

const referenceDocs = [
  { label: "Product guide", content: productGuideDoc },
  { label: "Agent guide", content: agentGuideDoc },
  { label: "Agent skills", content: skillsDoc },
  { label: "Deployment guide", content: deploymentDoc },
  { label: "Self-hosting guide", content: selfHostingDoc },
  { label: "Engineering handoff", content: handoffDoc },
  { label: "Security notes", content: securityDoc },
];

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function docId(label: string) {
  return slugify(label);
}

function rewriteMarkdownHref(href: string) {
  const normalized = href.replace(/^\.\//, "");
  const doc = referenceDocs.find((item) => {
    const label = docId(item.label);
    return (
      normalized === `${label}.md` ||
      normalized.endsWith(`/${label}.md`) ||
      normalized === "SKILLS.md" && item.label === "Agent skills" ||
      normalized === "HANDOFF.md" && item.label === "Engineering handoff" ||
      normalized === "SECURITY.md" && item.label === "Security notes" ||
      normalized.endsWith("deployment.md") && item.label === "Deployment guide" ||
      normalized.endsWith("self-hosting.md") && item.label === "Self-hosting guide" ||
      normalized.endsWith("product-guide.md") && item.label === "Product guide" ||
      normalized.endsWith("agent-guide.md") && item.label === "Agent guide"
    );
  });
  return doc ? `#${docId(doc.label)}` : href;
}

function inlineMarkdown(text: string) {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > cursor) {
      nodes.push(text.slice(cursor, match.index));
    }

    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(
        <code key={`${match.index}-code`} className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        nodes.push(
          <a
            key={`${match.index}-link`}
            href={rewriteMarkdownHref(linkMatch[2])}
            className="font-medium text-foreground underline underline-offset-4"
          >
            {linkMatch[1]}
          </a>,
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

  for (const line of lines) {
    if (codeLines) {
      if (line.startsWith("```")) {
        parts.push({ type: "code", language, text: codeLines.join("\n") });
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

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  if (codeLines) {
    parts.push({ type: "code", language, text: codeLines.join("\n") });
  }

  return parts;
}

function MarkdownDoc({ markdown }: { markdown: string }) {
  return (
    <div className="space-y-4">
      {parseMarkdown(markdown).map((part, index) => {
        if (part.type === "heading") {
          const Heading = part.depth <= 1 ? "h2" : part.depth === 2 ? "h3" : "h4";
          return (
            <Heading
              key={`${part.text}-${index}`}
              id={slugify(part.text)}
              className="pt-2 text-lg font-semibold text-foreground"
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
              className={`space-y-2 pl-5 text-sm leading-6 text-muted-foreground ${
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
              className="overflow-x-auto rounded-lg bg-foreground p-4 text-sm text-background"
            >
              <code>{part.text}</code>
            </pre>
          );
        }

        return (
          <p key={`p-${index}`} className="text-sm leading-6 text-muted-foreground">
            {inlineMarkdown(part.text)}
          </p>
        );
      })}
    </div>
  );
}

export function PublicDocsPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link to="/" className="font-semibold">docs-share</Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link to="/" className="rounded-lg px-3 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              Home
            </Link>
            <Link to="/app" className="rounded-lg bg-primary px-3 py-2 font-medium text-primary-foreground transition-colors hover:bg-primary/90">
              Open app
            </Link>
          </nav>
        </div>
      </header>

      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 py-12">
          <p className="mb-3 text-sm font-medium uppercase text-muted-foreground">
            Product docs
          </p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight">
            Run, use, and extend docs-share.
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground">
            These docs cover the common path for users, operators, and agents. The repository markdown guides are rendered below for deeper deployment and security references.
          </p>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-8 px-5 py-12 lg:grid-cols-[240px_1fr]">
        <aside className="space-y-2">
          {referenceDocs.map((doc) => (
            <a
              key={doc.label}
              href={`#${doc.label.toLowerCase().replaceAll(" ", "-")}`}
              className="block rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-muted"
            >
              {doc.label}
            </a>
          ))}
        </aside>

        <div className="space-y-8">
          {sections.map((section) => (
            <section key={section.title} className="rounded-lg border border-border p-6">
              <h2 className="text-xl font-semibold">{section.title}</h2>
              <ul className="mt-4 space-y-3">
                {section.items.map((item) => (
                  <li key={item} className="flex gap-3 text-sm leading-6 text-muted-foreground">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <section className="rounded-lg border border-border p-6">
            <h2 className="text-xl font-semibold">CLI commands for agents</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Agents should prefer URL-first commands with machine-readable output only when they need to pass structured results to another tool.
            </p>
            <pre className="mt-5 overflow-x-auto rounded-lg bg-foreground p-4 text-sm text-background"><code>{`docs-share draft ./plan.html
docs-share draft ./plan.html --json
docs-share push ./site --to team-slug/docs --message "Update docs"`}</code></pre>
          </section>

          <section className="space-y-5">
            <h2 className="text-xl font-semibold">Repository references</h2>
            {referenceDocs.map((doc) => (
              <article
                id={doc.label.toLowerCase().replaceAll(" ", "-")}
                key={doc.label}
                className="rounded-lg border border-border p-6"
              >
                <h3 className="text-lg font-semibold">{doc.label}</h3>
                <div className="mt-4 max-h-[620px] overflow-auto rounded-lg border border-border p-4">
                  <MarkdownDoc markdown={doc.content} />
                </div>
              </article>
            ))}
          </section>
        </div>
      </section>
    </main>
  );
}

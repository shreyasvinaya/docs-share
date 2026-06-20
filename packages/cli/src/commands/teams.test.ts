import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// teams members/invite resolve a team ref (slug or ID) to an ID. The old code
// used a `ref.length > 20` heuristic that misrouted long slugs (slugs can be up
// to 50 chars). We drive the real CLI against a mock server and assert which
// /api/teams/<id>/members path it hits, proving slug-first resolution.

const ENTRY = join(import.meta.dir, "..", "index.ts");

// A slug longer than the old 20-char heuristic threshold.
const LONG_SLUG = "engineering-platform-infrastructure-team"; // 40 chars
const TEAM_ID = "team_abc123";

let home: string;
let server: ReturnType<typeof Bun.serve>;
let membersPaths: string[];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ds-cli-teams-"));
  membersPaths = [];
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/api/teams") {
        return Response.json({
          data: [
            {
              id: TEAM_ID,
              name: "Eng Platform",
              slug: LONG_SLUG,
              ownerId: "u1",
              role: "owner",
              createdAt: new Date().toISOString(),
            },
          ],
        });
      }
      const m = url.pathname.match(/^\/api\/teams\/([^/]+)\/members$/);
      if (m) {
        membersPaths.push(m[1]);
        return Response.json({ data: [] });
      }
      return new Response("not found", { status: 404 });
    },
  });
});

afterEach(() => {
  server.stop(true);
  if (home) rmSync(home, { recursive: true, force: true });
});

function apiUrl(): string {
  return `http://localhost:${server.port}`;
}

async function runCli(args: string[]): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn(["bun", ENTRY, ...args], {
    env: {
      ...process.env,
      HOME: home,
      PATRA_TOKEN: "tok",
      DOCS_SHARE_TOKEN: "",
      PATRA_API_URL: apiUrl(),
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  return { code, stdout };
}

describe("teams resolveTeamId (L3 long-slug resolution)", () => {
  test("resolves a >20-char slug to its team ID (not treated as a raw ID)", async () => {
    const res = await runCli(["teams", "members", LONG_SLUG]);
    expect(res.code).toBe(0);
    // The members endpoint must have been hit with the resolved TEAM_ID, proving
    // the long slug was looked up rather than passed through as a raw ID.
    expect(membersPaths).toContain(TEAM_ID);
    expect(membersPaths).not.toContain(LONG_SLUG);
  });

  test("an unknown ref falls back to being treated as a raw ID", async () => {
    const res = await runCli(["teams", "members", "team_raw_999"]);
    expect(res.code).toBe(0);
    // No slug/id matched, so the ref is passed through verbatim to the endpoint.
    expect(membersPaths).toContain("team_raw_999");
  });

  test("an exact team ID still resolves to that ID", async () => {
    const res = await runCli(["teams", "members", TEAM_ID]);
    expect(res.code).toBe(0);
    expect(membersPaths).toContain(TEAM_ID);
  });
});

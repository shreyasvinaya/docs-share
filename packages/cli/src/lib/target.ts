import { ApiClient } from "./api-client.js";
import { NotFoundError, ValidationError } from "./errors.js";
import type { Team } from "@patra/shared";

export interface ResolvedTarget {
  repoId: string;
  subfolder: string;
  ownerType: "user" | "team";
  /** Display label: "personal" or the team slug */
  label: string;
}

/**
 * Defense-in-depth client-side validation for a slash-separated relative path
 * (a target subfolder or an upload's relative name). Rejects path segments that
 * could escape the intended directory or smuggle control characters past the
 * server: `..` traversal, absolute paths, empty segments, NUL/control chars, and
 * backslashes (which some servers treat as separators). The server is the real
 * authority, but a bad path should never leave the client.
 */
export function validatePathSegments(value: string, label = "path"): void {
  if (value === "") return;

  if (value.startsWith("/")) {
    throw new ValidationError(
      `Invalid ${label} "${value}": absolute paths are not allowed.`
    );
  }

  const segments = value.split("/");
  for (const seg of segments) {
    if (seg === "" || seg === ".") {
      throw new ValidationError(
        `Invalid ${label} "${value}": contains an empty or "." segment.`
      );
    }
    if (seg === "..") {
      throw new ValidationError(
        `Invalid ${label} "${value}": ".." path traversal is not allowed.`
      );
    }
    if (seg.includes("\\")) {
      throw new ValidationError(
        `Invalid ${label} "${value}": backslashes are not allowed.`
      );
    }
    // Reject NUL and other C0/C1 control characters.
    if (/[\u0000-\u001f\u007f-\u009f]/.test(seg)) {
      throw new ValidationError(
        `Invalid ${label} "${value}": contains control characters.`
      );
    }
  }
}

/**
 * Parse a target string and resolve it to a repoId + subfolder via the API.
 *
 * Target formats:
 *  - "personal"            -> user's personal repo, root
 *  - "personal/docs"       -> user's personal repo, subfolder "docs"
 *  - "my-team"             -> team repo for slug "my-team", root
 *  - "my-team/reports"     -> team repo for slug "my-team", subfolder "reports"
 */
export async function resolveTarget(
  client: ApiClient,
  target: string
): Promise<ResolvedTarget> {
  const parts = target.split("/");
  const owner = parts[0];
  const subfolder = parts.slice(1).join("/");

  // Defense in depth: reject a traversal/control-char subfolder before it ever
  // reaches the API.
  validatePathSegments(subfolder, "subfolder");

  if (owner === "personal") {
    const me = await client.get<{
      data: {
        id: string;
        email: string;
        displayName: string;
        repo: { id: string } | null;
      };
    }>("/api/users/me");

    if (!me.data.repo) {
      throw new NotFoundError(
        "Personal repository not found. Your account may not be fully set up."
      );
    }

    return {
      repoId: me.data.repo.id,
      subfolder,
      ownerType: "user",
      label: "personal",
    };
  }

  // Treat as team slug
  const teamsRes = await client.get<{
    data: Array<Team & { role: string }>;
  }>("/api/teams");

  const team = teamsRes.data.find((t) => t.slug === owner);
  if (!team) {
    throw new NotFoundError(
      `Team "${owner}" not found. Use "personal" for your personal repo, or check team slugs with \`patra teams\`.`
    );
  }

  // Look up the team's repo
  const repoRes = await client.get<{
    data: { id: string };
  }>(`/internal/repo?ownerType=team&ownerId=${team.id}`);

  return {
    repoId: repoRes.data.id,
    subfolder,
    ownerType: "team",
    label: team.slug,
  };
}

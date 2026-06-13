export function getTeamFilePathFromWildcard(wildcard: string | undefined) {
  if (!wildcard) return undefined;
  const normalized = wildcard.replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized === "files") return undefined;
  if (normalized.startsWith("files/")) return normalized.slice("files/".length);
  return normalized;
}

export function teamFilesRoute(teamId: string, path?: string) {
  const normalizedPath = path?.replace(/^\/+|\/+$/g, "");
  return normalizedPath
    ? `/teams/${teamId}/files/${normalizedPath}`
    : `/teams/${teamId}`;
}

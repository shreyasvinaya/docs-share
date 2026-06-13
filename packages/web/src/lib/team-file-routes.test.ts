import { expect, test } from "bun:test";
import { getTeamFilePathFromWildcard, teamFilesRoute } from "./team-file-routes";

test("teamFilesRoute builds folder management routes for team files", () => {
  expect(teamFilesRoute("team-1")).toBe("/teams/team-1");
  expect(teamFilesRoute("team-1", "linked-draft")).toBe(
    "/teams/team-1/files/linked-draft"
  );
  expect(teamFilesRoute("team-1", "linked-draft/assets")).toBe(
    "/teams/team-1/files/linked-draft/assets"
  );
});

test("getTeamFilePathFromWildcard normalizes team file route wildcards", () => {
  expect(getTeamFilePathFromWildcard(undefined)).toBeUndefined();
  expect(getTeamFilePathFromWildcard("")).toBeUndefined();
  expect(getTeamFilePathFromWildcard("files")).toBeUndefined();
  expect(getTeamFilePathFromWildcard("linked-draft")).toBe("linked-draft");
  expect(getTeamFilePathFromWildcard("linked-draft/assets")).toBe(
    "linked-draft/assets"
  );
  expect(getTeamFilePathFromWildcard("fileshare")).toBe("fileshare");
  expect(getTeamFilePathFromWildcard("files/linked-draft")).toBe("linked-draft");
  expect(getTeamFilePathFromWildcard("files/linked-draft/assets")).toBe(
    "linked-draft/assets"
  );
});

import { expect, test } from "bun:test";
import type { TeamRole } from "@patra/shared";
import { canRemoveMember } from "./team-members";

const member = (userId: string, role: TeamRole) => ({ userId, role });

test("owners and admins can remove other members", () => {
  expect(
    canRemoveMember({ viewerRole: "owner", viewerUserId: "u1", member: member("u2", "member"), ownerCount: 1 })
  ).toBe(true);
  expect(
    canRemoveMember({ viewerRole: "admin", viewerUserId: "u1", member: member("u2", "viewer"), ownerCount: 1 })
  ).toBe(true);
});

test("members and viewers cannot remove anyone", () => {
  expect(
    canRemoveMember({ viewerRole: "member", viewerUserId: "u1", member: member("u2", "viewer"), ownerCount: 1 })
  ).toBe(false);
  expect(
    canRemoveMember({ viewerRole: "viewer", viewerUserId: "u1", member: member("u2", "viewer"), ownerCount: 1 })
  ).toBe(false);
  expect(
    canRemoveMember({ viewerRole: undefined, viewerUserId: "u1", member: member("u2", "viewer"), ownerCount: 1 })
  ).toBe(false);
});

test("cannot remove yourself via this control", () => {
  expect(
    canRemoveMember({ viewerRole: "owner", viewerUserId: "u1", member: member("u1", "owner"), ownerCount: 2 })
  ).toBe(false);
});

test("cannot remove the last owner, but can remove a non-last owner", () => {
  expect(
    canRemoveMember({ viewerRole: "owner", viewerUserId: "u1", member: member("u2", "owner"), ownerCount: 1 })
  ).toBe(false);
  expect(
    canRemoveMember({ viewerRole: "owner", viewerUserId: "u1", member: member("u2", "owner"), ownerCount: 2 })
  ).toBe(true);
});

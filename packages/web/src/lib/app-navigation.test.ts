import { describe, expect, test } from "bun:test";
import { getAdminNavItems } from "./app-navigation";
import type { User } from "@docs-share/shared";

function user(role: User["role"]): User {
  return {
    id: "user_1",
    email: "abc@gmail.com",
    displayName: "ABC Admin",
    designation: null,
    avatarUrl: null,
    role,
    createdAt: new Date().toISOString(),
  };
}

describe("getAdminNavItems", () => {
  test("shows setup navigation for sysadmins", () => {
    expect(getAdminNavItems(user("sysadmin"))).toEqual([
      { label: "Setup", to: "/settings?tab=setup" },
    ]);
  });

  test("hides setup navigation for regular users", () => {
    expect(getAdminNavItems(user("user"))).toEqual([]);
  });
});

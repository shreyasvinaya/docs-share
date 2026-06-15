import { expect, test } from "bun:test";
import { buildGoogleAuthHref, buildLoginHref, safeClientNext } from "./next-url";

test("safeClientNext accepts safe same-origin paths and rejects the rest", () => {
  expect(safeClientNext("/view/public/abc")).toBe("/view/public/abc");
  expect(safeClientNext("/app")).toBe("/app");
  expect(safeClientNext(null)).toBeNull();
  expect(safeClientNext("")).toBeNull();
  expect(safeClientNext("app")).toBeNull();
  expect(safeClientNext("https://evil.com")).toBeNull();
  expect(safeClientNext("//evil.com")).toBeNull();
  expect(safeClientNext("/" + String.fromCharCode(92) + "evil.com")).toBeNull();
  expect(safeClientNext("/foo" + String.fromCharCode(127) + "bar")).toBeNull(); // DEL
});

test("buildLoginHref forwards a safe next and falls back to /login", () => {
  expect(buildLoginHref("/view/public/abc")).toBe(
    "/login?next=%2Fview%2Fpublic%2Fabc"
  );
  expect(buildLoginHref(null)).toBe("/login");
  expect(buildLoginHref("https://evil.com")).toBe("/login");
});

test("buildGoogleAuthHref forwards a safe next and falls back to /api/auth/google", () => {
  expect(buildGoogleAuthHref("/view/public/abc")).toBe(
    "/api/auth/google?next=%2Fview%2Fpublic%2Fabc"
  );
  expect(buildGoogleAuthHref(null)).toBe("/api/auth/google");
});

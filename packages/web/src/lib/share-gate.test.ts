import { expect, test } from "bun:test";
import { resolveShareGateView } from "./share-gate";

test("loading while the session is loading", () => {
  expect(
    resolveShareGateView("acme.com", { isLoading: true, email: null })
  ).toEqual({ kind: "loading" });
});

test("sign-in when unauthenticated", () => {
  expect(
    resolveShareGateView("acme.com", { isLoading: false, email: null })
  ).toEqual({ kind: "sign-in", domain: "acme.com" });
});

test("wrong-domain when signed in with a different domain", () => {
  expect(
    resolveShareGateView("acme.com", {
      isLoading: false,
      email: "person@gmail.com",
    })
  ).toEqual({ kind: "wrong-domain", domain: "acme.com", email: "person@gmail.com" });
});

test("allowed when domain matches (case-insensitive)", () => {
  expect(
    resolveShareGateView("Acme.com", {
      isLoading: false,
      email: "person@ACME.com",
    })
  ).toEqual({ kind: "allowed" });
});

test("allowed when no domain restriction is supplied", () => {
  expect(
    resolveShareGateView(null, { isLoading: false, email: null })
  ).toEqual({ kind: "allowed" });
});

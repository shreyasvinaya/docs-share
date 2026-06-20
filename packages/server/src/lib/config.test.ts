import { afterEach, describe, expect, test } from "bun:test";
import { requiredPositiveInt } from "./config.js";

const KEY = "DOCS_SHARE_TEST_INT";

afterEach(() => {
  delete process.env[KEY];
});

describe("requiredPositiveInt", () => {
  test("parses a valid positive integer", () => {
    process.env[KEY] = "250";
    expect(requiredPositiveInt(KEY, 60)).toBe(250);
  });

  test("falls back when the variable is unset", () => {
    expect(requiredPositiveInt(KEY, 60)).toBe(60);
  });

  test("falls back on an empty / whitespace value", () => {
    process.env[KEY] = "   ";
    expect(requiredPositiveInt(KEY, 60)).toBe(60);
  });

  test("falls back to the default on NaN (does not fail open)", () => {
    process.env[KEY] = "not-a-number";
    expect(requiredPositiveInt(KEY, 60)).toBe(60);
  });

  test("falls back on zero (never disables the guard)", () => {
    process.env[KEY] = "0";
    expect(requiredPositiveInt(KEY, 60)).toBe(60);
  });

  test("falls back on a negative value", () => {
    process.env[KEY] = "-5";
    expect(requiredPositiveInt(KEY, 60)).toBe(60);
  });

  test("falls back on a non-integer (fractional) value", () => {
    process.env[KEY] = "12.5";
    expect(requiredPositiveInt(KEY, 60)).toBe(60);
  });

  test("falls back on Infinity-like input", () => {
    process.env[KEY] = "Infinity";
    expect(requiredPositiveInt(KEY, 60)).toBe(60);
  });

  test("rejects trailing-garbage that parseInt would have accepted", () => {
    // `parseInt("120abc")` returns 120; Number("120abc") is NaN, so we fall
    // back to the safe default rather than silently accepting a typo'd value.
    process.env[KEY] = "120abc";
    expect(requiredPositiveInt(KEY, 60)).toBe(60);
  });
});

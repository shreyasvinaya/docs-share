import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import setupRoutes from "./setup.js";
import type { AppEnv } from "../lib/types.js";

const app = new Hono<AppEnv>();
app.route("/api/setup", setupRoutes);

describe("setup routes", () => {
  test("returns public setup status", async () => {
    const res = await app.request("/api/setup/status");
    const body = (await res.json()) as {
      data: {
        deploymentName: string;
        sysadmin: { configured: boolean };
        authentication: { googleOAuth: { configured: boolean } };
      };
    };

    expect(res.status).toBe(200);
    expect(body.data.deploymentName).toBe("Docs Share");
    expect(body.data.sysadmin.configured).toBe(false);
    expect(body.data.authentication.googleOAuth.configured).toBe(false);
  });
});

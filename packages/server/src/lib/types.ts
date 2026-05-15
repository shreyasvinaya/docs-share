import type { Hono } from "hono";

export type AppEnv = {
  Variables: {
    userId: string;
    authMethod: "session" | "api_token";
    tokenId: string;
  };
};

export type AppType = Hono<AppEnv>;

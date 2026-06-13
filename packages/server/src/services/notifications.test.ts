import { describe, expect, test } from "bun:test";
import {
  buildEmailShareNotification,
  buildSlackShareNotification,
} from "./notifications.js";

describe("share notifications", () => {
  test("builds email share notification payloads", () => {
    const payload = buildEmailShareNotification({
      appUrl: "https://docs.example.com",
      recipientEmail: "reader@example.com",
      sharerName: "Ada",
      resourceLabel: "plan.html",
    });

    expect(payload.to).toBe("reader@example.com");
    expect(payload.subject).toBe("Ada shared plan.html with you");
    expect(payload.html).toContain("https://docs.example.com/shared");
  });

  test("builds Slack share notification text without requiring recipient emails", () => {
    const text = buildSlackShareNotification({
      appUrl: "https://docs.example.com",
      sharerName: "Ada",
      resourceLabel: "plans",
      shareType: "team",
      permission: "write",
    });

    expect(text).toContain("Ada shared plans");
    expect(text).toContain("team");
    expect(text).toContain("write");
    expect(text).toContain("https://docs.example.com/shared");
  });
});

import { Command } from "commander";
import type { Draft } from "@docs-share/shared";
import { getClient } from "../lib/api-client.js";
import { output } from "../lib/output.js";
import {
  formatDraftUploadResult,
  type DraftOutputFormat,
} from "./draft-helpers.js";

export const draftDuplicateCommand = new Command("draft-duplicate")
  .description("Duplicate an existing draft into an independent copy")
  .argument("<draftId>", "ID of the draft to duplicate")
  .option("--json", "Print machine-readable JSON")
  .action(async (draftId: string, opts: { json?: boolean }) => {
    const result = await getClient().post<{ data: Draft }>(
      `/api/drafts/${draftId}/duplicate`
    );
    const format: DraftOutputFormat = opts.json ? "json" : "text";
    output(formatDraftUploadResult(result.data, format), "text");
  });

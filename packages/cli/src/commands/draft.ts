import { Command } from "commander";
import { basename } from "node:path";
import { readFileSync, statSync } from "node:fs";
import type { Draft } from "@docs-share/shared";
import { getClient } from "../lib/api-client.js";
import { CliError, EXIT_CODES, FileNotFoundError } from "../lib/errors.js";
import { output } from "../lib/output.js";
import {
  collectDraftFile,
  formatDraftUploadResult,
  type DraftOutputFormat,
} from "./draft-helpers.js";

export const draftCommand = new Command("draft")
  .description("Publish a single authenticated HTML draft and print its URL")
  .argument("<path>", "Local .html file to publish")
  .option("--title <title>", "Override the draft title")
  .option("--json", "Print machine-readable JSON")
  .action(async (localPath: string, opts: { title?: string; json?: boolean }) => {
    let stat;
    try {
      stat = statSync(localPath);
    } catch {
      throw new FileNotFoundError(localPath);
    }

    if (!stat.isFile()) {
      throw new CliError("Draft path must be a single HTML file.", EXIT_CODES.FILE_NOT_FOUND);
    }

    const bytes = readFileSync(localPath);
    const draftFile = collectDraftFile(basename(localPath), bytes);
    const formData = new FormData();
    const body = draftFile.bytes.buffer.slice(
      draftFile.bytes.byteOffset,
      draftFile.bytes.byteOffset + draftFile.bytes.byteLength
    ) as ArrayBuffer;
    formData.append(
      "file",
      new Blob([body], { type: "text/html; charset=utf-8" }),
      draftFile.fileName
    );

    if (opts.title) {
      formData.append("title", opts.title);
    }

    const result = await getClient().upload<{ data: Draft }>("/api/drafts", formData);
    const format: DraftOutputFormat = opts.json ? "json" : "text";
    const formatted = formatDraftUploadResult(result.data, format);

    output(formatted, "text");
  });

export { collectDraftFile, formatDraftUploadResult };

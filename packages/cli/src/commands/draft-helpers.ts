import type { Draft } from "@patra/shared";
import { CliError, EXIT_CODES } from "../lib/errors.js";

export interface DraftFile {
  fileName: string;
  bytes: Uint8Array;
  sizeBytes: number;
}

export type DraftOutputFormat = "text" | "json";

export function collectDraftFile(fileName: string, bytes: Uint8Array): DraftFile {
  const lowerName = fileName.toLowerCase();
  if (!lowerName.endsWith(".html") && !lowerName.endsWith(".htm")) {
    throw new CliError(
      "Draft uploads must be .html or .htm files",
      EXIT_CODES.VALIDATION_ERROR
    );
  }

  return {
    fileName,
    bytes,
    sizeBytes: bytes.byteLength,
  };
}

export function formatDraftUploadResult(
  result: Draft,
  format: DraftOutputFormat
): string {
  if (format === "json") {
    return JSON.stringify(result, null, 2);
  }

  return result.url;
}

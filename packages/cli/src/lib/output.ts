export function isInteractive(): boolean {
  return process.stdout.isTTY === true;
}

export function formatTable(headers: string[], rows: string[][]): string {
  const allRows = [headers, ...rows];
  const colWidths = headers.map((_, colIdx) =>
    Math.max(...allRows.map((row) => (row[colIdx] ?? "").length))
  );

  const separator = colWidths.map((w) => "-".repeat(w)).join("  ");
  const headerLine = headers.map((h, i) => h.padEnd(colWidths[i])).join("  ");
  const dataLines = rows.map((row) =>
    row.map((cell, i) => (cell ?? "").padEnd(colWidths[i])).join("  ")
  );

  return [headerLine, separator, ...dataLines].join("\n");
}

export function output(
  data: unknown,
  format?: "json" | "text" | "table"
): void {
  const resolvedFormat = format ?? (isInteractive() ? "text" : "json");

  if (resolvedFormat === "json") {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
    return;
  }

  if (resolvedFormat === "table" && Array.isArray(data) && data.length > 0) {
    const first = data[0] as Record<string, unknown>;
    const headers = Object.keys(first);
    const rows = data.map((item) =>
      headers.map((h) => String((item as Record<string, unknown>)[h] ?? ""))
    );
    process.stdout.write(formatTable(headers, rows) + "\n");
    return;
  }

  if (typeof data === "string") {
    process.stdout.write(data + "\n");
  } else {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  }
}

export function success(message: string): void {
  if (isInteractive()) {
    process.stdout.write(`\x1b[32m✓\x1b[0m ${message}\n`);
  }
}

export function error(message: string): void {
  if (isInteractive()) {
    process.stderr.write(`\x1b[31m✗\x1b[0m ${message}\n`);
  } else {
    process.stderr.write(JSON.stringify({ error: message }) + "\n");
  }
}

export function warn(message: string): void {
  // Warnings are always written to stderr (even non-interactively) so security
  // notices — plaintext token, --token visibility — never get silently dropped
  // in scripts/CI. Color is only added when attached to a TTY.
  if (process.stderr.isTTY === true) {
    process.stderr.write(`\x1b[33m!\x1b[0m ${message}\n`);
  } else {
    process.stderr.write(`WARNING: ${message}\n`);
  }
}

export function info(message: string): void {
  if (isInteractive()) {
    process.stdout.write(`  ${message}\n`);
  }
}

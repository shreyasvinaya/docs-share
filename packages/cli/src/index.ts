#!/usr/bin/env node

import { Command } from "commander";
import { loginCommand } from "./commands/login.js";
import { pushCommand } from "./commands/push.js";
import { draftCommand } from "./commands/draft.js";
import { draftDuplicateCommand } from "./commands/draft-duplicate.js";
import { lsCommand } from "./commands/ls.js";
import { shareCommand } from "./commands/share.js";
import { teamsCommand } from "./commands/teams.js";
import { whoamiCommand } from "./commands/whoami.js";
import { CliError, EXIT_CODES } from "./lib/errors.js";
import { error as printError } from "./lib/output.js";

const program = new Command();

program
  .name("patra")
  .description("CLI for the Patra platform — optimized for AI agent usage")
  .version("0.1.0")
  .option("--format <format>", "Output format: json, text, table")
  .option("--quiet", "Suppress non-essential output")
  .option("--api-url <url>", "Override API base URL")
  .option("--no-color", "Disable colored output")
  .option("--verbose", "Enable verbose logging");

// Store global options so commands can access them
program.hook("preAction", (_thisCommand, _actionCommand) => {
  const globalOpts = program.opts();

  // Set API URL override via env var so config.ts picks it up. Write both the
  // new PATRA_ name and the legacy DOCS_SHARE_ name so either resolver path
  // sees it.
  if (globalOpts.apiUrl) {
    process.env.PATRA_API_URL = globalOpts.apiUrl;
    process.env.DOCS_SHARE_API_URL = globalOpts.apiUrl;
  }

  // Disable color if requested
  if (globalOpts.color === false) {
    process.env.NO_COLOR = "1";
  }

  // Store format preference for output.ts
  if (globalOpts.format) {
    process.env.PATRA_FORMAT = globalOpts.format;
    process.env.DOCS_SHARE_FORMAT = globalOpts.format;
  }

  if (globalOpts.quiet) {
    process.env.PATRA_QUIET = "1";
    process.env.DOCS_SHARE_QUIET = "1";
  }

  if (globalOpts.verbose) {
    process.env.PATRA_VERBOSE = "1";
    process.env.DOCS_SHARE_VERBOSE = "1";
  }
});

// Register commands
program.addCommand(loginCommand);
program.addCommand(pushCommand);
program.addCommand(draftCommand);
program.addCommand(draftDuplicateCommand);
program.addCommand(lsCommand);
program.addCommand(shareCommand);
program.addCommand(teamsCommand);
program.addCommand(whoamiCommand);

function isVerbose(): boolean {
  if (process.env.PATRA_VERBOSE === "1" || process.env.DOCS_SHARE_VERBOSE === "1") {
    return true;
  }
  try {
    return program.opts().verbose === true;
  } catch {
    return false;
  }
}

/**
 * Print an error and exit. CliError carries its own exit code; anything else
 * exits with UNKNOWN. Full stack traces are only shown under --verbose.
 */
function handleFatal(err: unknown): never {
  if (err instanceof CliError) {
    printError(err.message);
    if (isVerbose() && err.stack) {
      console.error(err.stack);
    }
    process.exit(err.exitCode);
  }

  if (err instanceof Error) {
    printError(err.message);
    if (isVerbose()) {
      console.error(err.stack);
    }
    process.exit(EXIT_CODES.UNKNOWN);
  }

  printError(String(err));
  process.exit(EXIT_CODES.UNKNOWN);
}

// Last-resort safety nets: never let an unhandled rejection or thrown error
// crash with an ugly Node stack trace (and a confusing exit code).
process.on("unhandledRejection", (reason) => {
  handleFatal(reason);
});
process.on("uncaughtException", (err) => {
  handleFatal(err);
});

// Global error handler
async function main(): Promise<void> {
  await program.parseAsync(process.argv);
}

main().catch(handleFatal);

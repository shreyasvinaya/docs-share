#!/usr/bin/env node

import { Command } from "commander";
import { loginCommand } from "./commands/login.js";
import { pushCommand } from "./commands/push.js";
import { lsCommand } from "./commands/ls.js";
import { shareCommand } from "./commands/share.js";
import { teamsCommand } from "./commands/teams.js";
import { whoamiCommand } from "./commands/whoami.js";
import { CliError, EXIT_CODES } from "./lib/errors.js";
import { error as printError } from "./lib/output.js";

const program = new Command();

program
  .name("docs-share")
  .description("CLI for the docs-share platform — optimized for AI agent usage")
  .version("0.1.0")
  .option("--format <format>", "Output format: json, text, table")
  .option("--quiet", "Suppress non-essential output")
  .option("--api-url <url>", "Override API base URL")
  .option("--no-color", "Disable colored output")
  .option("--verbose", "Enable verbose logging");

// Store global options so commands can access them
program.hook("preAction", (_thisCommand, actionCommand) => {
  const globalOpts = program.opts();

  // Set API URL override via env var so config.ts picks it up
  if (globalOpts.apiUrl) {
    process.env.DOCS_SHARE_API_URL = globalOpts.apiUrl;
  }

  // Disable color if requested
  if (globalOpts.color === false) {
    process.env.NO_COLOR = "1";
  }

  // Store format preference for output.ts
  if (globalOpts.format) {
    process.env.DOCS_SHARE_FORMAT = globalOpts.format;
  }

  if (globalOpts.quiet) {
    process.env.DOCS_SHARE_QUIET = "1";
  }
});

// Register commands
program.addCommand(loginCommand);
program.addCommand(pushCommand);
program.addCommand(lsCommand);
program.addCommand(shareCommand);
program.addCommand(teamsCommand);
program.addCommand(whoamiCommand);

// Global error handler
async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if (err instanceof CliError) {
      printError(err.message);
      process.exit(err.exitCode);
    }

    if (err instanceof Error) {
      printError(err.message);
      if (process.env.DOCS_SHARE_VERBOSE === "1" || program.opts().verbose) {
        console.error(err.stack);
      }
      process.exit(EXIT_CODES.UNKNOWN);
    }

    printError(String(err));
    process.exit(EXIT_CODES.UNKNOWN);
  }
}

main();

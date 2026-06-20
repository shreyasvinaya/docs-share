import { Command } from "commander";
import { getClient } from "../lib/api-client.js";
import { output, success, formatTable, isInteractive } from "../lib/output.js";
import { NotFoundError } from "../lib/errors.js";
import type { Team, TeamMember } from "@patra/shared";

export const teamsCommand = new Command("teams")
  .description("Manage teams")
  .action(async () => {
    await listTeams();
  });

teamsCommand
  .command("create")
  .description("Create a new team")
  .argument("<name>", "Team display name")
  .option("--slug <slug>", "Custom slug (auto-generated from name if omitted)")
  .action(async (name: string, opts: { slug?: string }) => {
    const client = getClient();
    const slug = opts.slug ?? slugify(name);

    const res = await client.post<{ data: Team }>("/api/teams", {
      name,
      slug,
    });

    success(`Team "${res.data.name}" created (slug: ${res.data.slug})`);
    output(res.data);
  });

teamsCommand
  .command("members")
  .description("List team members")
  .argument("<team>", "Team slug or ID")
  .action(async (teamRef: string) => {
    const client = getClient();
    const teamId = await resolveTeamId(client, teamRef);

    const res = await client.get<{
      data: Array<TeamMember & { user?: { email: string; displayName: string } }>;
    }>(`/api/teams/${teamId}/members`);

    const members = res.data;

    if (isInteractive()) {
      if (members.length === 0) {
        process.stdout.write("No members found.\n");
      } else {
        process.stdout.write(
          formatTable(
            ["EMAIL", "NAME", "ROLE", "JOINED"],
            members.map((m) => [
              m.user?.email ?? "unknown",
              m.user?.displayName ?? "unknown",
              m.role,
              m.joinedAt ? new Date(m.joinedAt).toLocaleDateString() : "-",
            ])
          ) + "\n"
        );
      }
    } else {
      output(members);
    }
  });

teamsCommand
  .command("invite")
  .description("Invite a member to a team")
  .argument("<team>", "Team slug or ID")
  .argument("<email>", "Email address to invite")
  .option("--role <role>", "Role: owner, admin, member, viewer", "member")
  .action(async (teamRef: string, email: string, opts: { role: string }) => {
    const client = getClient();
    const teamId = await resolveTeamId(client, teamRef);

    const res = await client.post<{ data: unknown }>(
      `/api/teams/${teamId}/members`,
      { email, role: opts.role }
    );

    success(`Invited ${email} to team as ${opts.role}`);
    output(res.data);
  });

async function listTeams(): Promise<void> {
  const client = getClient();
  const res = await client.get<{
    data: Array<Team & { role: string }>;
  }>("/api/teams");

  const teams = res.data;

  if (isInteractive()) {
    if (teams.length === 0) {
      process.stdout.write("No teams found. Create one with `patra teams create <name>`.\n");
    } else {
      process.stdout.write(
        formatTable(
          ["SLUG", "NAME", "ROLE", "CREATED"],
          teams.map((t) => [
            t.slug,
            t.name,
            t.role,
            new Date(t.createdAt).toLocaleDateString(),
          ])
        ) + "\n"
      );
    }
  } else {
    output(teams);
  }
}

/**
 * Resolve a team reference (slug or ID) to a team ID.
 */
async function resolveTeamId(
  client: ReturnType<typeof getClient>,
  ref: string
): Promise<string> {
  // If it looks like a generated ID (long string), try it directly
  if (ref.length > 20) {
    return ref;
  }

  // Otherwise, treat as slug and look up
  const res = await client.get<{
    data: Array<Team & { role: string }>;
  }>("/api/teams");

  const team = res.data.find((t) => t.slug === ref || t.id === ref);
  if (!team) {
    throw new NotFoundError(`Team "${ref}" not found.`);
  }
  return team.id;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

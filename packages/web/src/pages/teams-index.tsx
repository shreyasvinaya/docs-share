import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useTeams } from "@/hooks/use-teams";
import { CreateTeamDialog } from "@/components/teams/create-team-dialog";
import { EmptyState } from "@/components/common/empty-state";

export function TeamsIndexPage() {
  const navigate = useNavigate();
  const { data: teams, isLoading } = useTeams();
  const [showCreateTeam, setShowCreateTeam] = useState(false);

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Teams</h1>
        <button
          type="button"
          onClick={() => setShowCreateTeam(true)}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Team
        </button>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          Loading teams...
        </div>
      ) : teams && teams.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {teams.map((team) => (
            <Link
              key={team.id}
              to={`/teams/${team.id}`}
              className="group rounded-lg border border-border p-5 transition-colors hover:bg-muted/50"
            >
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-lg font-bold text-primary-foreground">
                {team.name[0].toUpperCase()}
              </div>
              <h2 className="font-semibold group-hover:text-foreground">
                {team.name}
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{team.slug}</p>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No teams yet"
          description="Create a team to start collaborating with others."
          action={
            <button
              type="button"
              onClick={() => setShowCreateTeam(true)}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Create Team
            </button>
          }
        />
      )}

      <CreateTeamDialog
        open={showCreateTeam}
        onClose={() => setShowCreateTeam(false)}
        onCreated={(teamId) => navigate(`/teams/${teamId}`)}
      />
    </div>
  );
}

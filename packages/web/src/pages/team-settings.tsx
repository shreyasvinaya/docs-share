import { useState } from "react";
import { useParams, useNavigate } from "react-router";
import {
  useTeam,
  useTeamMembers,
  useInviteMember,
  useUpdateTeam,
  useRemoveMember,
} from "@/hooks/use-teams";
import { useSession } from "@/hooks/use-auth";
import { UserAvatar } from "@/components/common/user-avatar";
import { canRemoveMember } from "@/lib/team-members";
import { api } from "@/lib/api-client";
import type { TeamRole } from "@patra/shared";

export function TeamSettingsPage() {
  const { teamId } = useParams();
  const navigate = useNavigate();
  const { data: team } = useTeam(teamId);
  const { data: members } = useTeamMembers(teamId);
  const { data: session } = useSession();
  const inviteMember = useInviteMember(teamId!);
  const updateTeam = useUpdateTeam(teamId);
  const removeMember = useRemoveMember(teamId!);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("member");
  const [description, setDescription] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);

  const viewerUserId = session?.user.id;
  const viewerRole = members?.find((m) => m.userId === viewerUserId)?.role;
  const ownerCount = members?.filter((m) => m.role === "owner").length ?? 0;

  const currentDescription = description ?? team?.description ?? "";

  const handleSaveDescription = () => {
    const value = currentDescription.trim() || null;
    updateTeam.mutate(
      { description: value },
      { onSuccess: () => setDescription(null) },
    );
  };

  const descriptionChanged = description !== null && currentDescription !== (team?.description ?? "");

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    inviteMember.mutate(
      { email: email.trim(), role },
      { onSuccess: () => setEmail("") },
    );
  };

  const handleDelete = async () => {
    if (!teamId) return;
    setIsDeleting(true);
    try {
      await api.del(`/api/teams/${teamId}`);
      navigate("/teams");
    } catch {
      setIsDeleting(false);
    }
  };

  if (!team) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-bold">{team.name} Settings</h1>

      {/* Description */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold">Description</h2>
        <div className="rounded-lg border border-border p-4">
          <textarea
            value={currentDescription}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add a description for this team..."
            rows={3}
            maxLength={500}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {currentDescription.length}/500
            </span>
            {descriptionChanged && (
              <button
                type="button"
                onClick={handleSaveDescription}
                disabled={updateTeam.isPending}
                className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {updateTeam.isPending ? "Saving..." : "Save"}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Members */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold">Members</h2>

        {members && members.length > 0 ? (
          <div className="mb-4 rounded-lg border border-border">
            {members.map((member, i) => (
              <div
                key={member.id}
                className={`flex items-center justify-between px-4 py-3 ${
                  i < members.length - 1 ? "border-b border-border" : ""
                }`}
              >
                <div className="flex items-center gap-3">
                  <UserAvatar
                    displayName={member.user?.displayName ?? "Unknown"}
                    avatarUrl={member.user?.avatarUrl}
                    size="md"
                  />
                  <div>
                    <p className="text-sm font-medium">
                      {member.user?.displayName ?? "Unknown"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {member.user?.email ?? "No email"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium capitalize">
                    {member.role}
                  </span>
                  {canRemoveMember({
                    viewerRole,
                    viewerUserId,
                    member,
                    ownerCount,
                  }) &&
                    (confirmingRemoveId === member.userId ? (
                      <span className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            removeMember.mutate(member.userId, {
                              onSuccess: () => setConfirmingRemoveId(null),
                            })
                          }
                          disabled={removeMember.isPending}
                          className="rounded-md bg-destructive px-2.5 py-1 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
                        >
                          {removeMember.isPending ? "Removing..." : "Confirm"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingRemoveId(null)}
                          className="rounded-md border border-border px-2.5 py-1 text-xs transition-colors hover:bg-muted"
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmingRemoveId(member.userId)}
                        className="text-xs font-medium text-destructive transition-colors hover:underline"
                      >
                        Remove
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mb-4 text-sm text-muted-foreground">
            No members yet.
          </p>
        )}

        {removeMember.isError && (
          <p className="mb-3 text-sm text-destructive">
            Could not remove that member. They may be the team's last owner.
          </p>
        )}

        <p className="mb-4 text-xs text-muted-foreground">
          Removing a member revokes their access. Everything they uploaded to
          the team stays with the team.
        </p>

        {/* Invite form */}
        <form onSubmit={handleInvite} className="flex items-end gap-3">
          <div className="flex-1">
            <label
              htmlFor="invite-email"
              className="mb-1 block text-sm font-medium"
            >
              Invite by email
            </label>
            <input
              id="invite-email"
              type="email"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label
              htmlFor="invite-role"
              className="mb-1 block text-sm font-medium"
            >
              Role
            </label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as TeamRole)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            >
              <option value="viewer">Viewer</option>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={inviteMember.isPending || !email.trim()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {inviteMember.isPending ? "Inviting..." : "Invite"}
          </button>
        </form>

        {inviteMember.isError && (
          <p className="mt-2 text-sm text-destructive">
            Failed to invite member. Check the email and try again.
          </p>
        )}
      </section>

      {/* Danger zone */}
      <section className="rounded-lg border border-destructive/30 p-4">
        <h2 className="mb-2 text-lg font-semibold text-destructive">
          Danger Zone
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Deleting a team is permanent and cannot be undone. All files and
          shares will be removed.
        </p>

        {showDeleteConfirm ? (
          <div className="flex items-center gap-3">
            <p className="text-sm font-medium text-destructive">
              Are you sure?
            </p>
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              className="rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
            >
              {isDeleting ? "Deleting..." : "Yes, delete team"}
            </button>
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="rounded-lg border border-destructive/50 px-4 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
          >
            Delete Team
          </button>
        )}
      </section>
    </div>
  );
}

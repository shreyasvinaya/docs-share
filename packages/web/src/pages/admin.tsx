import { Navigate } from "react-router";
import { useSession } from "@/hooks/use-auth";
import { useAdminUsers, useUpdateUserRole, type AdminUser } from "@/hooks/use-admin";
import { cn } from "@/lib/utils";

export function AdminPage() {
  const { data: session, isLoading: sessionLoading } = useSession();

  if (sessionLoading) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (session?.user.role !== "sysadmin") {
    return <Navigate to="/app" replace />;
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-1 text-2xl font-bold">Users</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Manage deployment members and roles. Sysadmins can review setup and grant
        admin access.
      </p>
      <UsersTable currentUserId={session.user.id} />
    </div>
  );
}

function UsersTable({ currentUserId }: { currentUserId: string }) {
  const { data: users, isLoading, isError } = useAdminUsers();
  const updateRole = useUpdateUserRole();

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading users...</p>;
  }

  if (isError || !users) {
    return (
      <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        Could not load users.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/40 text-left text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">User</th>
            <th className="px-4 py-3 font-medium">Role</th>
            <th className="px-4 py-3 font-medium">Joined</th>
            <th className="px-4 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {users.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              isSelf={user.id === currentUserId}
              isPending={updateRole.isPending}
              onChangeRole={(role) =>
                updateRole.mutate({ userId: user.id, role })
              }
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UserRow({
  user,
  isSelf,
  isPending,
  onChangeRole,
}: {
  user: AdminUser;
  isSelf: boolean;
  isPending: boolean;
  onChangeRole: (role: AdminUser["role"]) => void;
}) {
  const nextRole: AdminUser["role"] =
    user.role === "sysadmin" ? "user" : "sysadmin";

  return (
    <tr>
      <td className="px-4 py-3">
        <p className="font-medium text-foreground">{user.displayName}</p>
        <p className="text-xs text-muted-foreground">{user.email}</p>
      </td>
      <td className="px-4 py-3">
        <span
          className={cn(
            "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
            user.role === "sysadmin"
              ? "bg-primary/10 text-primary"
              : "bg-muted text-muted-foreground"
          )}
        >
          {user.role}
        </span>
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {new Date(user.createdAt).toLocaleDateString()}
      </td>
      <td className="px-4 py-3 text-right">
        {isSelf ? (
          <span className="text-xs text-muted-foreground">You</span>
        ) : (
          <button
            type="button"
            disabled={isPending}
            onClick={() => onChangeRole(nextRole)}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {user.role === "sysadmin" ? "Revoke admin" : "Make admin"}
          </button>
        )}
      </td>
    </tr>
  );
}

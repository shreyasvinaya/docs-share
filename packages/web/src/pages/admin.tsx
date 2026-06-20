import { Navigate } from "react-router";
import { useSession } from "@/hooks/use-auth";
import { useAdminUsers, type AdminUser } from "@/hooks/use-admin";
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
      <p className="mb-4 text-sm text-muted-foreground">
        Review deployment members and their roles.
      </p>
      <p className="mb-6 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        Sysadmin access is configured via the{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
          SYSADMIN_EMAILS
        </code>{" "}
        environment variable, not from this page. To grant or revoke admin
        access, update <code className="font-mono text-xs">SYSADMIN_EMAILS</code>{" "}
        and restart the deployment.
      </p>
      <UsersTable currentUserId={session.user.id} />
    </div>
  );
}

function UsersTable({ currentUserId }: { currentUserId: string }) {
  const { data: users, isLoading, isError } = useAdminUsers();

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
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {users.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              isSelf={user.id === currentUserId}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UserRow({ user, isSelf }: { user: AdminUser; isSelf: boolean }) {
  return (
    <tr>
      <td className="px-4 py-3">
        <p className="font-medium text-foreground">
          {user.displayName}
          {isSelf ? (
            <span className="ml-2 text-xs text-muted-foreground">(You)</span>
          ) : null}
        </p>
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
    </tr>
  );
}

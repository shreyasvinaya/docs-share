import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: "user" | "sysadmin";
  createdAt: string;
}

export function useAdminUsers() {
  return useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const res = await api.get<{ users: AdminUser[] }>("/api/admin/users");
      return res.users;
    },
  });
}

// NOTE: There is intentionally no role-mutation hook. The sysadmin role is
// managed via the SYSADMIN_EMAILS environment variable (see the admin page
// note and docs/self-hosting.md); the API rejects role changes with 400.

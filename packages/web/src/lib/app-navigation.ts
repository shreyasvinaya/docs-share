import type { User } from "@patra/shared";

export interface AdminNavItem {
  label: string;
  to: string;
}

export function getAdminNavItems(user: User | undefined): AdminNavItem[] {
  if (user?.role !== "sysadmin") return [];
  return [
    { label: "Users", to: "/admin" },
    { label: "Setup", to: "/settings?tab=setup" },
  ];
}

import { useState } from "react";
import { NavLink, useNavigate } from "react-router";
import { useTeams } from "@/hooks/use-teams";
import { useSession } from "@/hooks/use-auth";
import { useDeploymentName } from "@/hooks/use-setup";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useUiStore } from "@/stores/ui-store";
import { cn } from "@/lib/utils";
import { getAdminNavItems } from "@/lib/app-navigation";
import { CreateTeamDialog } from "@/components/teams/create-team-dialog";

const mainNav = [
  {
    label: "Home",
    to: "/app",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
      </svg>
    ),
  },
  {
    label: "Files",
    to: "/files",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
      </svg>
    ),
  },
  {
    label: "Drafts",
    to: "/drafts",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h8.25c.298 0 .585.119.795.33l6 6c.211.21.33.497.33.795v8.25c0 .621-.504 1.125-1.125 1.125H4.875a1.125 1.125 0 01-1.125-1.125V4.875z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 3.75v6.75H20.25M8.25 15h7.5M8.25 17.25h4.5" />
      </svg>
    ),
  },
  {
    label: "Shared with me",
    to: "/shared",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
      </svg>
    ),
  },
];

export function AppSidebar() {
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const mobileNavOpen = useUiStore((s) => s.mobileNavOpen);
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  // Icon-rail collapse is a desktop-only affordance; the mobile drawer always
  // shows full labels.
  const collapsed = isDesktop && sidebarCollapsed;
  const navigate = useNavigate();
  const { data: teams } = useTeams();
  const { data: session } = useSession();
  const deploymentName = useDeploymentName();
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const user = session?.user;
  const adminNav = getAdminNavItems(user);

  return (
    <aside
      className={cn(
        // Mobile: off-canvas drawer (fixed, slides in over content).
        // Desktop (lg+): static rail that collapses to icons.
        "fixed inset-y-0 left-0 z-50 flex h-full w-64 flex-col border-r border-border bg-[#f7f4eb]/95 shadow-xl shadow-teal-950/5 transition-transform duration-200 dark:bg-[#0b1c19]/95",
        "lg:static lg:z-auto lg:translate-x-0 lg:shadow-xl lg:transition-all",
        mobileNavOpen ? "translate-x-0" : "-translate-x-full",
        collapsed ? "lg:w-16" : "lg:w-64",
      )}
    >
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0f766e] text-[#fef3c7] shadow-sm">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 20c4.5-3.1 7-7.2 7-11.1 0-2.7-2-5.4-7-6.9-5 1.5-7 4.2-7 6.9C5 12.8 7.5 16.9 12 20Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.5v10M9 9.5c1 .7 2 1 3 1s2-.3 3-1M8.6 13c1.1.8 2.2 1.2 3.4 1.2s2.3-.4 3.4-1.2" />
          </svg>
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <span className="block truncate text-sm font-semibold">
              {deploymentName}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              docs, drafts, sites
            </span>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-0.5">
          {mainNav.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === "/app"}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-lg border border-transparent px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "border-[#0f766e]/25 bg-[#0f766e] font-medium text-white shadow-sm"
                      : "text-muted-foreground hover:border-border hover:bg-background/75 hover:text-foreground",
                    collapsed && "justify-center px-0",
                  )
                }
              >
                {item.icon}
                {!collapsed && <span>{item.label}</span>}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="mt-6">
          {!collapsed && (
            <div className="mb-1 px-3">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Personal
              </h3>
            </div>
          )}
          <NavLink
            to="/files"
            aria-label={
              collapsed ? (user?.displayName ?? "My files") : undefined
            }
            title={collapsed ? (user?.displayName ?? "My files") : undefined}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg border border-transparent px-3 py-2 text-sm transition-colors",
                isActive
                  ? "border-[#0f766e]/25 bg-[#0f766e] font-medium text-white shadow-sm"
                  : "text-muted-foreground hover:border-border hover:bg-background/75 hover:text-foreground",
                collapsed && "justify-center px-0",
              )
            }
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#d7a82f]/20 text-[10px] font-bold uppercase text-[#7a5a16] dark:text-[#fde68a]">
              {user?.displayName?.[0] ?? "U"}
            </span>
            {!collapsed && (
              <span className="truncate">{user?.displayName ?? "My files"}</span>
            )}
          </NavLink>
        </div>

        <div className="mt-6">
          {!collapsed && (
            <div className="mb-1 flex items-center justify-between px-3">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Teams
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateTeam(true)}
                className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="Create team"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </button>
            </div>
          )}
          {teams && teams.length > 0 ? (
            <ul className="space-y-0.5">
              {teams.map((team) => (
                <li key={team.id}>
                  <NavLink
                    to={`/teams/${team.id}`}
                    aria-label={collapsed ? team.name : undefined}
                    title={collapsed ? team.name : undefined}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-3 rounded-lg border border-transparent px-3 py-2 text-sm transition-colors",
                        isActive
                          ? "border-[#0f766e]/25 bg-[#0f766e] font-medium text-white shadow-sm"
                          : "text-muted-foreground hover:border-border hover:bg-background/75 hover:text-foreground",
                        collapsed && "justify-center px-0",
                      )
                    }
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-accent text-[10px] font-bold uppercase text-accent-foreground">
                      {team.name[0]}
                    </span>
                    {!collapsed && <span className="truncate">{team.name}</span>}
                  </NavLink>
                </li>
              ))}
            </ul>
          ) : (
            !collapsed && (
              <p className="px-3 text-xs text-muted-foreground">No teams yet</p>
            )
          )}
        </div>

        {adminNav.length > 0 && (
          <div className="mt-6">
            {!collapsed && (
              <div className="mb-1 px-3">
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Admin
                </h3>
              </div>
            )}
            <ul className="space-y-0.5">
              {adminNav.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    aria-label={collapsed ? item.label : undefined}
                    title={collapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-3 rounded-lg border border-transparent px-3 py-2 text-sm transition-colors",
                        isActive
                          ? "border-[#0f766e]/25 bg-[#0f766e] font-medium text-white shadow-sm"
                          : "text-muted-foreground hover:border-border hover:bg-background/75 hover:text-foreground",
                        collapsed && "justify-center px-0",
                      )
                    }
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M12 3.75l7.5 3v5.25c0 4.35-3.19 8.43-7.5 9.75-4.31-1.32-7.5-5.4-7.5-9.75V6.75l7.5-3z" />
                    </svg>
                    {!collapsed && <span>{item.label}</span>}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>

      <div className="border-t border-border p-2">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-lg border border-transparent px-3 py-2 text-sm transition-colors",
              isActive
                ? "border-[#0f766e]/25 bg-[#0f766e] font-medium text-white shadow-sm"
                : "text-muted-foreground hover:border-border hover:bg-background/75 hover:text-foreground",
              collapsed && "justify-center px-0",
            )
          }
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          {!collapsed && <span>Settings</span>}
        </NavLink>
      </div>
      <CreateTeamDialog
        open={showCreateTeam}
        onClose={() => setShowCreateTeam(false)}
        onCreated={(teamId) => navigate(`/teams/${teamId}`)}
      />
    </aside>
  );
}

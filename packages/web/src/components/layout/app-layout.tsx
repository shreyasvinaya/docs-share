import { useState, useRef } from "react";
import { Outlet, useLocation, Link } from "react-router";
import { useSession, useLogout } from "@/hooks/use-auth";
import { useTeams } from "@/hooks/use-teams";
import { useUiStore } from "@/stores/ui-store";
import { UserAvatar } from "@/components/common/user-avatar";
import { AppSidebar } from "@/components/layout/app-sidebar";

function useBreadcrumbs(pathname: string) {
  const { data: teams } = useTeams();
  const segments = pathname.split("/").filter(Boolean);
  const crumbs: { label: string; to: string }[] = [];

  const labelMap: Record<string, string> = {
    files: "Files",
    shared: "Shared with me",
    preview: "Preview",
    teams: "Teams",
    settings: "Settings",
  };

  let path = "";
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    path += `/${segment}`;

    // If previous segment was "teams", look up the team name
    if (i > 0 && segments[i - 1] === "teams" && teams) {
      const team = teams.find((t) => t.id === segment);
      crumbs.push({ label: team?.name ?? segment, to: path });
    } else {
      crumbs.push({
        label: labelMap[segment] ?? decodeURIComponent(segment),
        to: path,
      });
    }
  }

  return crumbs;
}

const themeOptions = [
  { value: "light" as const, label: "Light" },
  { value: "dark" as const, label: "Dark" },
  { value: "system" as const, label: "System" },
];

export function AppLayout() {
  const { data: session } = useSession();
  const logout = useLogout();
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const location = useLocation();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const user = session?.user;
  const breadcrumbs = useBreadcrumbs(location.pathname);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AppSidebar />

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggleSidebar}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>

            <nav className="flex items-center gap-1 text-sm">
              <Link
                to="/"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                Home
              </Link>
              {breadcrumbs.map((crumb) => (
                <span key={crumb.to} className="flex items-center gap-1">
                  <span className="text-muted-foreground">/</span>
                  <Link
                    to={crumb.to}
                    className="text-muted-foreground transition-colors hover:text-foreground last:font-medium last:text-foreground"
                  >
                    {crumb.label}
                  </Link>
                </span>
              ))}
            </nav>
          </div>

          {user && (
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center gap-2 rounded-lg p-1.5 transition-colors hover:bg-muted"
              >
                <UserAvatar
                  displayName={user.displayName}
                  avatarUrl={user.avatarUrl}
                  size="sm"
                />
                <span className="hidden text-sm sm:inline">
                  {user.displayName}
                </span>
              </button>

              {dropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setDropdownOpen(false)}
                    onKeyDown={() => {}}
                    role="button"
                    tabIndex={-1}
                    aria-label="Close menu"
                  />
                  <div className="absolute right-0 z-50 mt-1 w-48 rounded-lg border border-border bg-background py-1 shadow-lg">
                    <div className="border-b border-border px-3 py-2">
                      <p className="text-sm font-medium">{user.displayName}</p>
                      <p className="text-xs text-muted-foreground">
                        {user.email}
                      </p>
                    </div>

                    <div className="border-b border-border px-3 py-2">
                      <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                        Theme
                      </p>
                      <div className="flex gap-1 rounded-lg bg-muted p-0.5">
                        {themeOptions.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setTheme(opt.value)}
                            className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                              theme === opt.value
                                ? "bg-background shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <Link
                      to="/settings"
                      onClick={() => setDropdownOpen(false)}
                      className="block px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      Settings
                    </Link>
                    <button
                      type="button"
                      onClick={() => logout.mutate()}
                      className="block w-full px-3 py-2 text-left text-sm text-destructive transition-colors hover:bg-muted"
                    >
                      Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </header>

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

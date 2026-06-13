import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { useSession } from "@/hooks/use-auth";
import { AppLayout } from "@/components/layout/app-layout";
import { LoginPage } from "@/pages/login";
import { PublicDocsPage } from "@/pages/public-docs";
import { PublicHomePage } from "@/pages/public-home";
import { DashboardPage } from "@/pages/dashboard";
import { PersonalFilesPage } from "@/pages/personal-files";
import { SharedWithMePage } from "@/pages/shared-with-me";
import { FilePreviewPage } from "@/pages/file-preview";
import { TeamsIndexPage } from "@/pages/teams-index";
import { TeamOverviewPage } from "@/pages/team-overview";
import { TeamSettingsPage } from "@/pages/team-settings";
import { SettingsPage } from "@/pages/settings";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { data, isLoading, isError } = useSession();
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }
  if (isError || !data) return <Navigate to="/login" />;
  return <>{children}</>;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PublicHomePage />} />
        <Route path="/docs" element={<PublicDocsPage />} />
        <Route path="/docs/:guide" element={<PublicDocsPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route path="app" element={<DashboardPage />} />
          {/* Keep legacy app URLs stable while the public site owns `/`. */}
          <Route path="files/*" element={<PersonalFilesPage />} />
          <Route path="shared" element={<SharedWithMePage />} />
          <Route path="preview/:repoId/*" element={<FilePreviewPage />} />
          <Route path="teams" element={<TeamsIndexPage />} />
          <Route path="teams/:teamId" element={<TeamOverviewPage />} />
          <Route
            path="teams/:teamId/settings"
            element={<TeamSettingsPage />}
          />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

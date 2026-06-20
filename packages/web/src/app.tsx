import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { useSession } from "@/hooks/use-auth";
import { IS_PUBLIC_SITE } from "@/lib/public-site";
import { AppLayout } from "@/components/layout/app-layout";
import { LoginPage } from "@/pages/login";
import { ShareGatePage } from "@/pages/share-gate";
import { PublicDocsPage } from "@/pages/public-docs";
import { PublicHomePage } from "@/pages/public-home";
import { SetupPage } from "@/pages/setup";
import { DashboardPage } from "@/pages/dashboard";
import { DraftsPage } from "@/pages/drafts";
import { DraftFormsPage } from "@/pages/draft-forms";
import { PersonalFilesPage } from "@/pages/personal-files";
import { SharedWithMePage } from "@/pages/shared-with-me";
import { FilePreviewPage } from "@/pages/file-preview";
import { TeamsIndexPage } from "@/pages/teams-index";
import { TeamOverviewPage } from "@/pages/team-overview";
import { TeamSettingsPage } from "@/pages/team-settings";
import { SettingsPage } from "@/pages/settings";
import { AdminPage } from "@/pages/admin";

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

// Static GitHub Pages build: only the marketing home + docs, served under the
// repo subpath via Vite's BASE_URL. No API/server is available here, so the
// authenticated app, login, setup, and share-gate routes are not mounted.
function PublicSiteApp() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<PublicHomePage />} />
        <Route path="/docs" element={<PublicDocsPage />} />
        <Route path="/docs/:guide" element={<PublicDocsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export function App() {
  if (IS_PUBLIC_SITE) {
    return <PublicSiteApp />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PublicHomePage />} />
        <Route path="/docs" element={<PublicDocsPage />} />
        <Route path="/docs/:guide" element={<PublicDocsPage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/share-gate" element={<ShareGatePage />} />
        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route path="app" element={<DashboardPage />} />
          {/* Keep legacy app URLs stable while the public site owns `/`. */}
          <Route path="drafts" element={<DraftsPage />} />
          <Route path="drafts/:draftId/forms" element={<DraftFormsPage />} />
          <Route path="files/*" element={<PersonalFilesPage />} />
          <Route path="shared" element={<SharedWithMePage />} />
          <Route path="preview/:repoId/*" element={<FilePreviewPage />} />
          <Route path="teams" element={<TeamsIndexPage />} />
          <Route path="teams/:teamId" element={<TeamOverviewPage />} />
          <Route path="teams/:teamId/files/*" element={<TeamOverviewPage />} />
          <Route
            path="teams/:teamId/settings"
            element={<TeamSettingsPage />}
          />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="admin" element={<AdminPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

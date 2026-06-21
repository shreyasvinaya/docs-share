import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { useSession } from "@/hooks/use-auth";
import { IS_PUBLIC_SITE } from "@/lib/public-site";
import { AppLayout } from "@/components/layout/app-layout";
// The landing + docs are eager (they are the public site and the app's "/").
import { PublicDocsPage } from "@/pages/public-docs";
import { PublicHomePage } from "@/pages/public-home";

// Everything else is route-split: each page loads on demand, so the initial
// (and the static GitHub Pages) bundle does not ship the whole product surface.
function lazyPage(
  loader: () => Promise<Record<string, unknown>>,
  name: string
) {
  return lazy(async () => ({
    default: (await loader())[name] as React.ComponentType,
  }));
}

const LoginPage = lazyPage(() => import("@/pages/login"), "LoginPage");
const ShareGatePage = lazyPage(() => import("@/pages/share-gate"), "ShareGatePage");
const SetupPage = lazyPage(() => import("@/pages/setup"), "SetupPage");
const DashboardPage = lazyPage(() => import("@/pages/dashboard"), "DashboardPage");
const DraftsPage = lazyPage(() => import("@/pages/drafts"), "DraftsPage");
const DraftFormsPage = lazyPage(() => import("@/pages/draft-forms"), "DraftFormsPage");
const PersonalFilesPage = lazyPage(() => import("@/pages/personal-files"), "PersonalFilesPage");
const SharedWithMePage = lazyPage(() => import("@/pages/shared-with-me"), "SharedWithMePage");
const FilePreviewPage = lazyPage(() => import("@/pages/file-preview"), "FilePreviewPage");
const TeamsIndexPage = lazyPage(() => import("@/pages/teams-index"), "TeamsIndexPage");
const TeamOverviewPage = lazyPage(() => import("@/pages/team-overview"), "TeamOverviewPage");
const TeamSettingsPage = lazyPage(() => import("@/pages/team-settings"), "TeamSettingsPage");
const SettingsPage = lazyPage(() => import("@/pages/settings"), "SettingsPage");
const AdminPage = lazyPage(() => import("@/pages/admin"), "AdminPage");

function PageFallback() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { data, isLoading, isError } = useSession();
  if (isLoading) return <PageFallback />;
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
      <Suspense fallback={<PageFallback />}>
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
            <Route path="teams/:teamId/settings" element={<TeamSettingsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="admin" element={<AdminPage />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

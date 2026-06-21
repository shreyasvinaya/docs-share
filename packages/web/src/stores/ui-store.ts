import { create } from "zustand";
import { persist } from "zustand/middleware";

type Theme = "light" | "dark" | "system";

interface UiState {
  sidebarCollapsed: boolean;
  /** Off-canvas mobile nav drawer (transient — not persisted). */
  mobileNavOpen: boolean;
  fileViewMode: "grid" | "list" | "tree";
  theme: Theme;
  toggleSidebar: () => void;
  setMobileNavOpen: (open: boolean) => void;
  toggleMobileNav: () => void;
  setFileViewMode: (mode: "grid" | "list" | "tree") => void;
  setTheme: (theme: Theme) => void;
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
  } else if (theme === "light") {
    root.classList.remove("dark");
  } else {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.classList.toggle("dark", prefersDark);
  }
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      mobileNavOpen: false,
      fileViewMode: "tree",
      theme: "system" as Theme,
      toggleSidebar: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
      toggleMobileNav: () => set((s) => ({ mobileNavOpen: !s.mobileNavOpen })),
      setFileViewMode: (mode) => set({ fileViewMode: mode }),
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
    }),
    {
      name: "docs-share-ui",
      // Persist only durable preferences; the mobile drawer is transient so it
      // never restores "open" on reload.
      partialize: (s) => ({
        sidebarCollapsed: s.sidebarCollapsed,
        fileViewMode: s.fileViewMode,
        theme: s.theme,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme);
      },
    }
  )
);

// Listen for system preference changes when in "system" mode
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  const { theme } = useUiStore.getState();
  if (theme === "system") applyTheme("system");
});

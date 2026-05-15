import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UiState {
  sidebarCollapsed: boolean;
  fileViewMode: "grid" | "list" | "tree";
  toggleSidebar: () => void;
  setFileViewMode: (mode: "grid" | "list" | "tree") => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      fileViewMode: "tree",
      toggleSidebar: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setFileViewMode: (mode) => set({ fileViewMode: mode }),
    }),
    { name: "docs-share-ui" }
  )
);

// Authored preview for Patra's PublicThemeControl — the light/dark/system theme
// switcher used in the public header. The dropdown opens on click (internal
// state); the static card shows the closed trigger button. The open menu is an
// interaction-only state (noted in NOTES.md), so it isn't captured statically.
import { PublicThemeControl } from "@patra/web";

export function Control() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: 12 }}>
      <PublicThemeControl />
    </div>
  );
}

// Authored preview for Patra's UserAvatar. Each named export is one card cell.
import { UserAvatar } from "@patra/web";

const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 16,
};

// Primary variant axis: size (sm / md / lg), shown with the initials fallback —
// the branded path that uses the DS's primary token.
export function Sizes() {
  return (
    <div style={row}>
      <UserAvatar displayName="Ada Lovelace" size="sm" />
      <UserAvatar displayName="Ada Lovelace" size="md" />
      <UserAvatar displayName="Ada Lovelace" size="lg" />
    </div>
  );
}

// Initials are derived from the display name (up to two), so different people
// read as distinct avatars.
export function Initials() {
  return (
    <div style={row}>
      <UserAvatar displayName="Shreyas Vinaya" />
      <UserAvatar displayName="Grace Hopper" />
      <UserAvatar displayName="Linus Torvalds" />
      <UserAvatar displayName="Patra" />
    </div>
  );
}

// With a real image source the avatar renders the photo instead of initials.
export function WithImage() {
  return (
    <div style={row}>
      <UserAvatar
        displayName="Ada Lovelace"
        size="lg"
        avatarUrl="https://i.pravatar.cc/120?img=47"
      />
      <UserAvatar
        displayName="Grace Hopper"
        size="lg"
        avatarUrl="https://i.pravatar.cc/120?img=15"
      />
    </div>
  );
}

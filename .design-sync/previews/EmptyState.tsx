// Authored preview for Patra's EmptyState. Each named export is one card cell.
import { EmptyState } from "@patra/web";

// EmptyState applies `[&>svg]:h-12 [&>svg]:w-12` to its icon slot, so the icon
// is passed as a bare <svg> (size is controlled by the component).
function DocIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
      />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z"
      />
    </svg>
  );
}

// The canonical empty state: title + supporting copy, centered.
export function Default() {
  return (
    <EmptyState
      title="No drafts yet"
      description="Drafts published by the CLI will appear here."
    />
  );
}

// With a leading icon for a stronger empty surface.
export function WithIcon() {
  return (
    <EmptyState
      icon={<DocIcon />}
      title="No files yet"
      description="Upload your first HTML file to get started."
    />
  );
}

// With a call-to-action, using Patra's primary button idiom.
export function WithAction() {
  return (
    <EmptyState
      icon={<ShareIcon />}
      title="Nothing shared with you"
      description="When a teammate shares a document or site, it shows up here."
      action={
        <button
          type="button"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors"
        >
          Browse files
        </button>
      }
    />
  );
}

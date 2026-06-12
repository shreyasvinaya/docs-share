import { useState } from "react";
import { useCreateTeam } from "@/hooks/use-teams";

interface CreateTeamDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (teamId: string) => void;
}

export function CreateTeamDialog({
  open,
  onClose,
  onCreated,
}: CreateTeamDialogProps) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");

  const createTeam = useCreateTeam();

  if (!open) return null;

  const autoSlug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const effectiveSlug = slugTouched ? slug : autoSlug;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !effectiveSlug.trim()) return;

    createTeam.mutate(
      {
        name: name.trim(),
        slug: effectiveSlug.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
      },
      {
        onSuccess: (team) => {
          setName("");
          setSlug("");
          setSlugTouched(false);
          setDescription("");
          onClose();
          onCreated?.(team.id);
        },
      },
    );
  };

  const handleClose = () => {
    setName("");
    setSlug("");
    setSlugTouched(false);
    setDescription("");
    createTeam.reset();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={handleClose}
        onKeyDown={(e) => e.key === "Escape" && handleClose()}
        role="button"
        tabIndex={0}
        aria-label="Close dialog"
      />
      <div className="relative w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Create Team</h2>
          <button
            type="button"
            onClick={handleClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="team-name"
              className="mb-1 block text-sm font-medium"
            >
              Team name
            </label>
            <input
              id="team-name"
              type="text"
              placeholder="My Team"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              autoFocus
            />
          </div>

          <div>
            <label
              htmlFor="team-slug"
              className="mb-1 block text-sm font-medium"
            >
              URL slug
            </label>
            <input
              id="team-slug"
              type="text"
              placeholder="my-team"
              value={effectiveSlug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugTouched(true);
              }}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Lowercase letters, numbers, and hyphens only.
            </p>
          </div>

          <div>
            <label
              htmlFor="team-description"
              className="mb-1 block text-sm font-medium"
            >
              Description
              <span className="ml-1 font-normal text-muted-foreground">(optional)</span>
            </label>
            <textarea
              id="team-description"
              placeholder="What is this team for?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={500}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>

          {createTeam.isError && (
            <p className="text-sm text-destructive">
              {createTeam.error?.message || "Failed to create team."}
            </p>
          )}

          <button
            type="submit"
            disabled={
              createTeam.isPending ||
              !name.trim() ||
              !effectiveSlug.trim()
            }
            className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {createTeam.isPending ? "Creating..." : "Create Team"}
          </button>
        </form>
      </div>
    </div>
  );
}

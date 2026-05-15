import { useState } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";
import type { FileNode } from "@docs-share/shared";

interface FileTreeProps {
  files: FileNode[];
  repoId: string;
  basePath?: string;
  onNavigate?: (path: string) => void;
}

export function FileTree({ files, repoId, basePath, onNavigate }: FileTreeProps) {
  const sorted = [...files].sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="divide-y divide-border rounded-lg border border-border">
      {sorted.map((node) => (
        <FileTreeRow
          key={node.path}
          node={node}
          repoId={repoId}
          basePath={basePath}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}

function FileTreeRow({
  node,
  repoId,
  basePath,
  onNavigate,
}: {
  node: FileNode;
  repoId: string;
  basePath?: string;
  onNavigate?: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isDir = node.type === "directory";

  const formatSize = (bytes: number | null) => {
    if (!bytes) return "--";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (date: string | null) => {
    if (!date) return "--";
    return new Date(date).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  if (isDir) {
    return (
      <button
        type="button"
        onClick={() => {
          if (onNavigate) {
            onNavigate(node.path);
          } else {
            setExpanded(!expanded);
          }
        }}
        className={cn(
          "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/50",
        )}
      >
        <FolderIcon />
        <span className="flex-1 truncate text-sm font-medium">
          {node.name}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatDate(node.updatedAt)}
        </span>
      </button>
    );
  }

  return (
    <Link
      to={`/preview/${repoId}/${node.path}`}
      className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50"
    >
      <FileIcon mimeType={node.mimeType} />
      <span className="flex-1 truncate text-sm">{node.name}</span>
      <span className="text-xs text-muted-foreground">
        {formatSize(node.sizeBytes)}
      </span>
      <span className="text-xs text-muted-foreground">
        {formatDate(node.updatedAt)}
      </span>
    </Link>
  );
}

function FolderIcon() {
  return (
    <svg
      className="h-5 w-5 shrink-0 text-amber-500"
      fill="currentColor"
      viewBox="0 0 20 20"
    >
      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
    </svg>
  );
}

function FileIcon({ mimeType }: { mimeType: string | null }) {
  const isHtml =
    mimeType?.includes("html") || mimeType?.includes("xhtml");

  return (
    <svg
      className={cn("h-5 w-5 shrink-0", isHtml ? "text-blue-500" : "text-muted-foreground")}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
      />
    </svg>
  );
}

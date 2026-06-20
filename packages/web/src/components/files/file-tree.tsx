import { useRef, useState } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";
import { ShareDialog } from "@/components/sharing/share-dialog";
import { useDeleteFile, useUploadFile } from "@/hooks/use-files";
import type { FileNode } from "@patra/shared";
import type { UploadItem } from "@/hooks/use-files";

interface FileTreeProps {
  files: FileNode[];
  repoId: string;
  basePath?: string;
  onNavigate?: (path: string) => void;
}

export function FileTree({ files, repoId, basePath, onNavigate }: FileTreeProps) {
  const [shareTarget, setShareTarget] = useState<{ path: string; name: string } | null>(null);

  const sorted = [...files].sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <>
      <div className="divide-y divide-border rounded-lg border border-border">
        {sorted.map((node) => (
          <FileTreeRow
            key={node.path}
            node={node}
            repoId={repoId}
            basePath={basePath}
            onNavigate={onNavigate}
            onShare={() => setShareTarget({ path: node.path, name: node.name })}
          />
        ))}
      </div>

      {shareTarget && (
        <ShareDialog
          open
          onClose={() => setShareTarget(null)}
          repoId={repoId}
          path={shareTarget.path}
          fileName={shareTarget.name}
        />
      )}
    </>
  );
}

function FileTreeRow({
  node,
  repoId,
  basePath,
  onNavigate,
  onShare,
}: {
  node: FileNode;
  repoId: string;
  basePath?: string;
  onNavigate?: (path: string) => void;
  onShare: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadFile(repoId);
  const deleteFile = useDeleteFile(repoId);
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

  const handleDelete = () => {
    const confirmed = window.confirm(
      `Delete ${node.type === "directory" ? "folder" : "file"} "${node.path}"?`
    );
    if (!confirmed) return;
    deleteFile.mutate(node.path);
  };

  const handleReplacement = (files: FileList | null) => {
    const selected = Array.from(files ?? []);
    if (selected.length === 0) return;

    let items: UploadItem[];
    if (isDir) {
      items = selected.map((file) => {
        const fileWithPath = file as File & { webkitRelativePath?: string };
        const rawPath = fileWithPath.webkitRelativePath || file.name;
        const segments = rawPath.split("/").filter(Boolean);
        const pathInsideSelection =
          segments[0] === node.name ? segments.slice(1).join("/") : rawPath;
        return {
          file,
          relativePath: `${node.path}/${pathInsideSelection || file.name}`,
        };
      });
    } else {
      const replacement = selected[0];
      items = [{ file: replacement, relativePath: node.path }];
    }

    upload.mutate({
      items,
      message: `Update ${node.path}`,
    });
  };

  const rowActions = (
    <div className="mr-2 flex items-center gap-1">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (isDir) folderInputRef.current?.click();
          else fileInputRef.current?.click();
        }}
        disabled={upload.isPending}
        className="rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        title={isDir ? "Update folder" : "Replace file"}
      >
        {isDir ? "Update" : "Replace"}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onShare();
        }}
        className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title="Share"
      >
        <ShareIcon />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleDelete();
        }}
        disabled={deleteFile.isPending}
        className="rounded px-2 py-1 text-xs text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
        title="Delete"
      >
        Delete
      </button>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(event) => {
          handleReplacement(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          handleReplacement(event.target.files);
          event.target.value = "";
        }}
        {...{ webkitdirectory: "", directory: "" }}
      />
    </div>
  );

  if (isDir) {
    return (
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => {
            if (onNavigate) {
              onNavigate(node.path);
            } else {
              setExpanded(!expanded);
            }
          }}
          className="flex flex-1 items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/50"
        >
          <FolderIcon />
          <span className="flex-1 truncate text-sm font-medium">
            {node.name}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatDate(node.updatedAt)}
          </span>
        </button>
        {rowActions}
      </div>
    );
  }

  return (
    <div className="flex items-center">
      <Link
        to={`/preview/${repoId}/${node.path}`}
        className="flex flex-1 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50"
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
      {rowActions}
    </div>
  );
}

function ShareIcon() {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z"
      />
    </svg>
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

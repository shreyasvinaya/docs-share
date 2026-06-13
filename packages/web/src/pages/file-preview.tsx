import { useParams, useNavigate } from "react-router";
import { useCommits, useFiles } from "@/hooks/use-files";
import { useEffect, useState } from "react";
import { ShareDialog } from "@/components/sharing/share-dialog";
import { FileTree } from "@/components/files/file-tree";

export function FilePreviewPage() {
  const { repoId, "*": wildcard } = useParams();
  const filePath = wildcard ?? "";
  const navigate = useNavigate();
  const [showHistory, setShowHistory] = useState(false);
  const [showShare, setShowShare] = useState(false);

  const { data: commits } = useCommits(repoId, filePath);
  const { data: rootFiles, isLoading: rootFilesLoading } = useFiles(
    repoId,
    filePath ? undefined : ""
  );

  useEffect(() => {
    if (!repoId || filePath || !rootFiles) return;

    const rootIndex = rootFiles.find(
      (file) => file.type === "file" && file.name.toLowerCase() === "index.html"
    );
    const firstDirectory = rootFiles.find((file) => file.type === "directory");
    const target = rootIndex ?? firstDirectory;
    if (target) {
      navigate(`/preview/${repoId}/${target.path}`, { replace: true });
    }
  }, [repoId, filePath, rootFiles, navigate]);

  const fileName = filePath.split("/").pop() || "Preview";
  const viewUrl = repoId
    ? `/view/${repoId}${filePath ? `/${filePath}` : ""}`
    : "";

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
          </button>
          <div>
            <h1 className="text-sm font-semibold">{fileName}</h1>
            <p className="text-xs text-muted-foreground">{filePath}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowShare(true)}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-muted"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
            </svg>
            Share
          </button>
          <button
            type="button"
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-muted"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            History
          </button>
          <a
            href={viewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-muted"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
            Open in new tab
          </a>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {filePath ? (
          <div className="flex-1">
            <iframe
              src={viewUrl}
              title={fileName}
              sandbox="allow-scripts"
              className="h-full w-full border-0"
            />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="mx-auto max-w-4xl">
              <h2 className="mb-2 text-lg font-semibold">Choose a file to preview</h2>
              <p className="mb-4 text-sm text-muted-foreground">
                This repository root does not have an index.html file. Open a
                file or folder below.
              </p>
              {rootFilesLoading ? (
                <p className="text-sm text-muted-foreground">Loading files...</p>
              ) : rootFiles && rootFiles.length > 0 && repoId ? (
                <FileTree
                  files={rootFiles}
                  repoId={repoId}
                  onNavigate={(path) =>
                    navigate(`/preview/${repoId}/${path}`)
                  }
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  No files are available to preview.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Version history sidebar */}
        {showHistory && (
          <div className="w-72 shrink-0 overflow-y-auto border-l border-border bg-muted/30">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">Version History</h2>
            </div>
            {commits && commits.length > 0 ? (
              <ul className="divide-y divide-border">
                {commits.map((commit) => (
                  <li key={commit.sha} className="px-4 py-3">
                    <p className="text-sm font-medium leading-snug">
                      {commit.message}
                    </p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{commit.authorName}</span>
                      <span>
                        {new Date(commit.date).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                      {commit.sha.slice(0, 7)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No history available.
              </p>
            )}
          </div>
        )}
      </div>

      {repoId && (
        <ShareDialog
          open={showShare}
          onClose={() => setShowShare(false)}
          repoId={repoId}
          path={filePath || null}
          fileName={fileName}
        />
      )}
    </div>
  );
}

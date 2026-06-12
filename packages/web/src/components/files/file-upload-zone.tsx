import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { UploadItem } from "@/hooks/use-files";

interface BrowserFileEntry {
  isFile: true;
  isDirectory: false;
  name: string;
  fullPath: string;
  file: (success: (file: File) => void, error?: (error: DOMException) => void) => void;
}

interface BrowserDirectoryEntry {
  isFile: false;
  isDirectory: true;
  name: string;
  fullPath: string;
  createReader: () => {
    readEntries: (
      success: (entries: BrowserEntry[]) => void,
      error?: (error: DOMException) => void
    ) => void;
  };
}

type BrowserEntry = BrowserFileEntry | BrowserDirectoryEntry;

function readFileEntry(entry: BrowserFileEntry, prefix: string) {
  return new Promise<UploadItem>((resolve, reject) => {
    entry.file(
      (file) =>
        resolve({
          file,
          relativePath: `${prefix}${entry.name}`,
        }),
      reject
    );
  });
}

async function readDirectoryEntry(
  entry: BrowserDirectoryEntry,
  prefix = ""
): Promise<UploadItem[]> {
  const reader = entry.createReader();
  const entries: BrowserEntry[] = [];

  while (true) {
    const batch = await new Promise<BrowserEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) break;
    entries.push(...batch);
  }

  const nested = await Promise.all(
    entries.map((child) =>
      child.isFile
        ? readFileEntry(child, `${prefix}${entry.name}/`)
        : readDirectoryEntry(child, `${prefix}${entry.name}/`)
    )
  );
  return nested.flat();
}

interface FileUploadZoneProps {
  onUpload: (items: UploadItem[]) => void;
  isUploading?: boolean;
  accept?: string;
  className?: string;
}

export function FileUploadZone({
  onUpload,
  isUploading,
  accept,
  className,
}: FileUploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const createUploadItems = useCallback((files: File[]) => {
    return files.map((file) => {
      const fileWithPath = file as File & { webkitRelativePath?: string };
      return {
        file,
        relativePath: fileWithPath.webkitRelativePath || file.name,
      };
    });
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const entries = Array.from(e.dataTransfer.items)
        .map((item) => {
          const itemWithEntry = item as unknown as {
            webkitGetAsEntry?: () => BrowserEntry | null;
          };
          return itemWithEntry.webkitGetAsEntry?.() ?? null;
        })
        .filter((entry): entry is BrowserEntry => entry !== null);

      if (entries.length > 0) {
        const nested = await Promise.all(
          entries.map((entry) =>
            entry.isFile ? readFileEntry(entry, "") : readDirectoryEntry(entry)
          )
        );
        const items = nested.flat();
        if (items.length > 0) onUpload(items);
        return;
      }

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) onUpload(createUploadItems(files));
    },
    [createUploadItems, onUpload],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length > 0) onUpload(createUploadItems(files));
      e.target.value = "";
    },
    [createUploadItems, onUpload],
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={cn(
        "relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors",
        isDragging
          ? "border-primary bg-primary/5"
          : "border-border hover:border-muted-foreground/40",
        isUploading && "pointer-events-none opacity-60",
        className,
      )}
    >
      <svg
        className="mb-3 h-10 w-10 text-muted-foreground"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.338-2.32 3.75 3.75 0 013.571 5.735A3 3 0 0118 19.5H6.75z"
        />
      </svg>

      {isUploading ? (
        <p className="text-sm text-muted-foreground">Uploading...</p>
      ) : (
        <>
          <p className="text-sm font-medium">
            Drop files here or{" "}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-primary underline underline-offset-2"
            >
              browse
            </button>
            <span className="text-muted-foreground"> or </span>
            <button
              type="button"
              onClick={() => folderInputRef.current?.click()}
              className="text-primary underline underline-offset-2"
            >
              choose a folder
            </button>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            HTML bundles keep their folder paths for linked pages and assets
          </p>
        </>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={accept}
        onChange={handleFileChange}
        className="hidden"
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        onChange={handleFileChange}
        className="hidden"
        {...{ webkitdirectory: "", directory: "" }}
      />
    </div>
  );
}

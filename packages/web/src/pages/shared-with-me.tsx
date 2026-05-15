import { Link } from "react-router";
import { useIncomingShares } from "@/hooks/use-sharing";
import { EmptyState } from "@/components/common/empty-state";

export function SharedWithMePage() {
  const { data: items, isLoading } = useIncomingShares();

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="mb-6 text-2xl font-bold">Shared with Me</h1>

      {isLoading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          Loading...
        </div>
      ) : items && items.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 font-medium text-muted-foreground">
                  File
                </th>
                <th className="px-4 py-3 font-medium text-muted-foreground">
                  Shared by
                </th>
                <th className="px-4 py-3 font-medium text-muted-foreground">
                  Permission
                </th>
                <th className="px-4 py-3 font-medium text-muted-foreground">
                  Date
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.share.id}
                  className="border-b border-border last:border-0 transition-colors hover:bg-muted/30"
                >
                  <td className="px-4 py-3">
                    <Link
                      to={`/preview/${item.share.repoId}/${item.share.path ?? ""}`}
                      className="flex items-center gap-2 font-medium hover:underline"
                    >
                      <svg
                        className="h-4 w-4 shrink-0 text-blue-500"
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
                      {item.fileName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <div>
                      <span>{item.ownerName}</span>
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({item.ownerEmail})
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
                      {item.share.permission === "read" ? "View" : "Edit"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(item.share.createdAt).toLocaleDateString(
                      undefined,
                      {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      },
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="Nothing shared with you yet"
          description="When someone shares a file with you, it will appear here."
          icon={
            <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
            </svg>
          }
        />
      )}
    </div>
  );
}

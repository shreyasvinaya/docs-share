export function formatLastOpened(lastViewedAt: string | null): string {
  if (!lastViewedAt) return "Never opened";
  const date = new Date(lastViewedAt);
  if (Number.isNaN(date.getTime())) return "Never opened";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatViewSummary(stats: {
  totalViews: number;
  uniqueVisitors: number;
}): string {
  if (stats.totalViews === 0) return "No views yet";
  const views = `${stats.totalViews} ${stats.totalViews === 1 ? "view" : "views"}`;
  const visitors = `${stats.uniqueVisitors} ${
    stats.uniqueVisitors === 1 ? "visitor" : "visitors"
  }`;
  return `${views} · ${visitors}`;
}

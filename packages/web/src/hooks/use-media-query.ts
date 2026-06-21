import { useEffect, useState } from "react";

/**
 * Subscribe to a CSS media query and re-render on changes.
 *
 * Used to branch interaction behaviour (not just layout) between viewports —
 * e.g. the app shell uses `useMediaQuery("(min-width: 1024px)")` to decide
 * whether the menu button collapses the desktop rail or opens the mobile drawer.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

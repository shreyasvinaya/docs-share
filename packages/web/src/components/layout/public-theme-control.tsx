import { useState } from "react";
import { useUiStore } from "@/stores/ui-store";

type ThemeOption = "light" | "dark" | "system";

const themeOptions = [
  { value: "light" as const, label: "Light" },
  { value: "dark" as const, label: "Dark" },
  { value: "system" as const, label: "System" },
];

function ThemeIcon({ theme }: { theme: ThemeOption }) {
  if (theme === "light") {
    return (
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.8}
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 3v2.25m0 13.5V21m6.36-15.36-1.59 1.59M7.23 16.77l-1.59 1.59M21 12h-2.25M5.25 12H3m15.36 6.36-1.59-1.59M7.23 7.23 5.64 5.64M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
        />
      </svg>
    );
  }

  if (theme === "dark") {
    return (
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.8}
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21 12.79A8.25 8.25 0 1 1 11.21 3 6.75 6.75 0 0 0 21 12.79Z"
        />
      </svg>
    );
  }

  return (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.8}
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4.5 5.25h15A1.5 1.5 0 0 1 21 6.75v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 15.25v-8.5a1.5 1.5 0 0 1 1.5-1.5ZM8.25 20.25h7.5M12 16.75v3.5"
      />
    </svg>
  );
}

export function PublicThemeControl() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const [open, setOpen] = useState(false);

  function selectTheme(nextTheme: ThemeOption) {
    setTheme(nextTheme);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label={`Theme: ${theme}`}
        aria-expanded={open}
        title="Theme"
      >
        <ThemeIcon theme={theme} />
      </button>

      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
            aria-label="Close theme menu"
            tabIndex={-1}
          />
          <div className="absolute right-0 z-50 mt-2 w-40 rounded-lg border border-border bg-background p-1 shadow-lg">
            {themeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => selectTheme(option.value)}
                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                  theme === option.value
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <ThemeIcon theme={option.value} />
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

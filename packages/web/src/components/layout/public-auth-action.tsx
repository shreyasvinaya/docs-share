import { Link } from "react-router";
import { useOptionalSession } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

type PublicAuthActionProps = {
  variant?: "primary" | "subtle";
  className?: string;
  signedOutLabel?: string;
  signedInLabel?: string;
};

export function PublicAuthAction({
  variant = "primary",
  className,
  signedOutLabel = "Sign in",
  signedInLabel = "Open app",
}: PublicAuthActionProps) {
  const { data, isLoading } = useOptionalSession();

  if (isLoading) {
    return null;
  }

  const signedIn = Boolean(data?.user);
  const base =
    variant === "primary"
      ? "rounded-lg bg-primary px-3 py-2 font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      : "rounded-lg px-3 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

  return (
    <Link to={signedIn ? "/app" : "/login"} className={cn(base, className)}>
      {signedIn ? signedInLabel : signedOutLabel}
    </Link>
  );
}

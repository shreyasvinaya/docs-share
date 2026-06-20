import type { SetupCheck, SetupStatus } from "@/hooks/use-setup";
import { cn } from "@/lib/utils";

interface SetupChecklistProps {
  status: SetupStatus;
}

export function SetupChecklist({ status }: SetupChecklistProps) {
  const groups = [
    {
      title: "Environment",
      checks: [
        status.environment.appUrl,
        status.environment.contentOrigin,
        status.environment.devLogin,
      ],
    },
    {
      title: "Access",
      checks: [status.sysadmin, status.authentication.googleOAuth],
    },
    {
      title: "Integrations",
      checks: [
        status.integrations.githubApp,
        status.integrations.githubPatFallback,
      ],
    },
    {
      title: "Security",
      checks: [status.security.productionSecrets],
    },
  ];

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section key={group.title} className="rounded-lg border border-border">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">{group.title}</h2>
          </div>
          <ul className="divide-y divide-border">
            {group.checks.map((check) => (
              <SetupCheckRow key={check.label} check={check} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function SetupCheckRow({ check }: { check: SetupCheck }) {
  return (
    <li className="flex gap-3 px-4 py-3">
      <span
        className={cn(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold",
          check.configured
            ? "bg-emerald-100 text-emerald-700"
            : "bg-amber-100 text-amber-800"
        )}
      >
        {check.configured ? "ok" : "!"}
      </span>
      <div>
        <p className="text-sm font-medium">{check.label}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{check.detail}</p>
      </div>
    </li>
  );
}

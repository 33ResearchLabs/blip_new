import type { ReactNode } from "react";

export function ChartCard({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`card card-pad flex flex-col ${className}`}>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="chart-title">{title}</div>
          {subtitle ? <div className="chart-sub">{subtitle}</div> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

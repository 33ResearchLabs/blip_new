"use client";

import { memo, useRef } from "react";
import {
  CheckCircle2,
  ArrowUpDown,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Clock,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";

interface CompletedOrdersPanelProps {
  orders: any[];
  onSelectOrder: (order: any) => void;
  collapsed?: boolean;
  onCollapseChange?: (collapsed: boolean) => void;
}

const ITEM_HEIGHT = 80;

export const CompletedOrdersPanel = memo(function CompletedOrdersPanel({
  orders,
  onSelectOrder,
  collapsed = false,
  onCollapseChange,
}: CompletedOrdersPanelProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: orders.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ITEM_HEIGHT,
    overscan: 5,
  });

  return (
    <div className={`flex flex-col ${collapsed ? "" : "h-full"}`}>
      {/* Header */}
      <div
        className="px-3 py-2 border-b border-section-divider cursor-pointer select-none hover:bg-foreground/[0.02] transition-colors"
        onClick={() => onCollapseChange?.(!collapsed)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ChevronDown
              className={`w-3 h-3 text-foreground/30 transition-transform duration-200 ${collapsed ? "-rotate-90" : ""}`}
            />
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500/50" />
            <h2 className="text-[10px] font-bold text-foreground/60 font-mono tracking-wider uppercase">
              Completed
            </h2>
          </div>
          <span className="text-[10px] border border-foreground/[0.08] text-foreground/50 px-1.5 py-0.5 rounded-full font-mono tabular-nums">
            {orders.length}
          </span>
        </div>
      </div>

      {/* Orders List */}
      {!collapsed &&
        (orders.length === 0 ? (
          <div className="flex-1 overflow-y-auto p-1.5">
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <div className="w-10 h-10 rounded-full border border-foreground/[0.06] bg-foreground/[0.02] flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-foreground/20" />
              </div>
              <div className="text-center">
                <p className="text-[11px] font-medium text-foreground/30 mb-0.5">
                  No completed trades
                </p>
                <p className="text-[9px] text-foreground/15 font-mono">
                  Finished orders appear here
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div ref={parentRef} className="flex-1 overflow-y-auto p-1.5">
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const order = orders[virtualRow.index];
                const completedAt =
                  order.dbOrder?.completed_at ||
                  order.dbOrder?.updated_at ||
                  order.timestamp;
                const completedDate = completedAt
                  ? new Date(completedAt)
                  : null;

                return (
                  <div
                    key={order.id}
                    ref={virtualizer.measureElement}
                    data-index={virtualRow.index}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    className="pb-1"
                  >
                    <div
                      onClick={() => onSelectOrder(order)}
                      className="px-3 py-2.5 glass-card rounded-lg hover:border-foreground/[0.10] transition-colors cursor-pointer"
                    >
                      <div className="flex items-start gap-2.5">
                        {/* Swap icon with status badge */}
                        <div className="relative flex-shrink-0 mt-0.5">
                          <div className="w-8 h-8 rounded-full bg-foreground/[0.06] flex items-center justify-center">
                            <ArrowUpDown className="w-4 h-4 text-foreground/50" />
                          </div>
                          <div className="absolute -bottom-0.5 -left-0.5 w-3.5 h-3.5 rounded-full bg-emerald-500/20 flex items-center justify-center">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          </div>
                        </div>

                        {/* Content: stacks vertically */}
                        <div className="flex flex-col gap-1 min-w-0 flex-1">
                          {/* Name */}
                          <span className="text-sm font-semibold text-foreground truncate">
                            {order.user || "Unknown"}
                          </span>

                          {/* Date */}
                          <div className="flex items-center gap-1 text-foreground/40">
                            <Clock className="w-3 h-3 flex-shrink-0" />
                            <span className="text-[10px] font-mono whitespace-nowrap">
                              {completedDate
                                ? formatCompletedDate(completedDate)
                                : "—"}
                            </span>
                          </div>
                        </div>

                        {/* Amounts + status: stacks vertically, right-aligned */}
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-medium text-foreground/60 tabular-nums whitespace-nowrap">
                              {Math.round(order.amount).toLocaleString()}{" "}
                              {order.fromCurrency}
                            </span>
                            <ChevronRight className="w-3 h-3 text-foreground/20" />
                            <span className="text-sm font-bold text-emerald-400 tabular-nums whitespace-nowrap">
                              +{Math.round(
                                order.amount * (order.rate || 3.67),
                              ).toLocaleString()}{" "}
                              {order.toCurrency || "AED"}
                            </span>
                          </div>
                          <span className="text-[9px] font-mono text-foreground/30 tracking-wider uppercase">
                            Status: Completed
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
    </div>
  );
});

function formatCompletedDate(date: Date): string {
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

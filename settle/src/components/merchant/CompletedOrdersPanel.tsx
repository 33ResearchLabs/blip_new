"use client";

import { memo, useRef } from "react";
import { CheckCircle2, ArrowRight, ChevronDown } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";

interface CompletedOrdersPanelProps {
  orders: any[];
  onSelectOrder: (order: any) => void;
  collapsed?: boolean;
  onCollapseChange?: (collapsed: boolean) => void;
}

const ITEM_HEIGHT = 72;

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
    <div className={`flex flex-col ${collapsed ? '' : 'h-full'}`}>
      {/* Header */}
      <div
        className="px-3 py-2 border-b border-white/[0.04] cursor-pointer select-none hover:bg-white/[0.02] transition-colors"
        onClick={() => onCollapseChange?.(!collapsed)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ChevronDown className={`w-3 h-3 text-white/30 transition-transform duration-200 ${collapsed ? '-rotate-90' : ''}`} />
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500/50" />
            <h2 className="text-[10px] font-bold text-white/60 font-mono tracking-wider uppercase">
              Completed
            </h2>
          </div>
          <span className="text-[10px] border border-white/[0.08] text-white/50 px-1.5 py-0.5 rounded-full font-mono tabular-nums">
            {orders.length}
          </span>
        </div>
      </div>

      {/* Orders List */}
      {!collapsed && (
        orders.length === 0 ? (
          <div className="flex-1 overflow-y-auto p-1.5">
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <div className="w-10 h-10 rounded-full border border-white/[0.06] bg-white/[0.02] flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-white/20" />
              </div>
              <div className="text-center">
                <p className="text-[11px] font-medium text-white/30 mb-0.5">
                  No completed trades
                </p>
                <p className="text-[9px] text-white/15 font-mono">
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
                const completedAt = order.updated_at || order.created_at;
                const timeAgo = completedAt
                  ? getTimeAgo(new Date(completedAt))
                  : "";

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
                      className="p-2.5 glass-card rounded-lg hover:border-white/[0.10] transition-colors cursor-pointer"
                    >
                      {/* Row 1: User + type + time */}
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-medium text-white/80 capitalize">
                          {order.user || "Unknown"}
                        </span>
                        <span className="text-[9px] text-white/25 font-mono">
                          {timeAgo}
                        </span>
                      </div>

                      {/* Row 2: Amount */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-bold text-white tabular-nums">
                          {Math.round(order.amount).toLocaleString()}{" "}
                          {order.fromCurrency}
                        </span>
                        <ArrowRight className="w-3 h-3 text-white/20" />
                        <span className="text-sm font-bold text-emerald-400 tabular-nums">
                          {Math.round(
                            order.amount * (order.rate || 3.67),
                          ).toLocaleString()}{" "}
                          {order.toCurrency || "AED"}
                        </span>
                        <div className="flex-1" />
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500/40" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )
      )}
    </div>
  );
});

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

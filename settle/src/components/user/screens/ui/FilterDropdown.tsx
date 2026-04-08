"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export interface FilterOption<T extends string> {
  key: T;
  label: string;
}

interface FilterDropdownProps<T extends string> {
  value: T;
  options: ReadonlyArray<FilterOption<T>>;
  onChange: (value: T) => void;
  className?: string;
  ariaLabel?: string;
  /** Which side the menu's edge anchors to. Default "right" (menu opens leftward). */
  align?: "left" | "right";
}

/**
 * Compact dropdown filter — shows only the active option as a pill.
 * Click to expand a small dark menu of all options. Closes on outside click
 * or Escape. Generic over the option key type so callers get type safety.
 */
export function FilterDropdown<T extends string>({
  value,
  options,
  onChange,
  className = "",
  ariaLabel = "Filter",
  align = "right",
}: FilterDropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click + Escape
  useEffect(() => {
    if (!open) return;
    const handlePointer = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("touchstart", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("touchstart", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const activeLabel = options.find((o) => o.key === value)?.label ?? "";

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1 px-3 py-1 rounded-full transition-all"
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.05em",
          background: "rgba(255,255,255,0.08)",
          color: "#fff",
          border: "1px solid rgba(255,255,255,0.12)",
        }}
      >
        <span>{activeLabel}</span>
        <ChevronDown
          size={12}
          strokeWidth={2.5}
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
            className={`absolute ${align === "left" ? "left-0" : "right-0"} mt-1.5 z-50 min-w-[110px] rounded-xl overflow-hidden`}
            style={{
              background: "rgba(20,20,22,0.96)",
              border: "1px solid rgba(255,255,255,0.08)",
              boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
            }}
          >
            {options.map(({ key, label }) => {
              const selected = key === value;
              return (
                <li key={key}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onChange(key);
                      setOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 transition-colors hover:bg-white/[0.08]"
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.04em",
                      color: selected ? "#fff" : "rgba(255,255,255,0.55)",
                      background: selected ? "rgba(255,255,255,0.06)" : "transparent",
                    }}
                  >
                    {label}
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

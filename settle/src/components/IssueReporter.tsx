"use client";

/**
 * <IssueReporter /> — state-driven floating button + modal for
 * user-initiated issue reports.
 *
 * Layout (design spec):
 *   Left (~62%) — "Capture and highlight the issue"
 *     • Annotation toolbar (Highlight / Arrow / Text / Pen / Rectangle
 *       · Undo / Redo / Clear All)
 *     • Screenshot preview (annotation canvas)
 *     • Tip line + "Retake Screenshot" button
 *   Right (~38%) — "Issue Details"
 *     • Title (required)
 *     • Category (UI Bug / Backend / Payment / Performance / Other)
 *     • Description (required, 500-char cap, live counter)
 *     • Attachments (drag-drop upload zone, ≤5 files, 25MB each)
 *     • Cancel + orange Submit Issue button
 *     • "Your feedback helps us improve Blip.money" footer
 *
 * Entry points:
 *   - Floating bottom-right button
 *   - Ctrl/Cmd+Shift+I shortcut (installed by useIssueReporter)
 *   - External callers via useIssueReporter().open()
 */

import {
  Bug,
  CloudUpload,
  Crop,
  Loader2,
  Lock,
  Monitor,
  Paperclip,
  Send,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AttachmentInput,
  ISSUE_CATEGORIES,
  IssueCategory,
  useIssueReporter,
} from "@/hooks/useIssueReporter";
import { useMerchantStore } from "@/stores/merchantStore";
import { IssueAnnotator } from "./IssueAnnotator";
import { RegionSelector, type Region } from "./RegionSelector";

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25MB
const ACCEPTED_MIMES =
  "image/*,video/mp4,video/webm,video/quicktime,text/plain,application/json,application/pdf";

// Multi-screenshot caps. Mirrors the server (api/issues/create.ts) and
// migration 109 — keep the three in sync.
const MAX_SCREENSHOTS = 5;
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024; // 5MB per the spec
const SCREENSHOT_ACCEPTED_MIMES = "image/png,image/jpeg,image/webp";

// One screenshot entry in the multi-shot list. `source` is the raw
// dataUrl (capture or upload); `annotated` is the overlay produced by
// the IssueAnnotator the next time it exports — null until the user
// has drawn anything.
interface ShotEntry {
  id: string;
  source: string;
  annotated: string | null;
  type: "screenshot" | "upload";
  mime?: string;
  size_bytes?: number;
}

function newShotId(): string {
  if (
    typeof globalThis !== "undefined" &&
    (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
      ?.randomUUID
  ) {
    return (globalThis as { crypto: { randomUUID: () => string } }).crypto.randomUUID();
  }
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

interface Toast {
  variant: "success" | "error";
  message: string;
}

// Global opener — lets any component (e.g. a header icon) open the
// reporter without needing to be a child of IssueReporter. Mirrors the
// pattern used by ModalContext in this codebase.
let openIssueReporterGlobal: (() => Promise<void>) | null = null;

export function openIssueReporter(): Promise<void> {
  return openIssueReporterGlobal
    ? openIssueReporterGlobal()
    : Promise.resolve();
}

export function IssueReporter({
  triggerLabel = "Report Issue",
  position = "bottom-right",
  authed: authedProp,
  hideTrigger = false,
}: {
  triggerLabel?: string;
  position?: "bottom-right" | "bottom-left";
  /**
   * Caller-supplied login state. When provided, this is the source of
   * truth for gating the button. When omitted, the component falls back
   * to reading the merchant store — so the merchant layout works
   * unchanged, and the user page can pass its own auth signal.
   */
  authed?: boolean;
  /**
   * Hide the floating trigger button — use when an external component
   * (e.g. a header icon) owns the trigger and opens the reporter via
   * the exported `openIssueReporter()` function.
   */
  hideTrigger?: boolean;
}) {
  const isLoggedIn = useMerchantStore((s) => s.isLoggedIn);
  const merchantId = useMerchantStore((s) => s.merchantId);
  const authed =
    authedProp !== undefined ? authedProp : isLoggedIn || !!merchantId;
  const reporter = useIssueReporter({ enabled: authed });

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<IssueCategory>("ui_bug");
  const [description, setDescription] = useState("");
  // Multi-screenshot state. Each entry carries its source (raw capture or
  // uploaded file) and an optional annotated overlay produced by the
  // IssueAnnotator. The submit path prefers `annotated` and falls back
  // to `source` when no annotation has been made yet.
  const [shots, setShots] = useState<ShotEntry[]>([]);
  const [selectedShotIdx, setSelectedShotIdx] = useState(0);
  const [attachments, setAttachments] = useState<AttachmentInput[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const [dragActive, setDragActive] = useState(false);
  // Region-capture mode: when the user picks "Region", we temporarily
  // hide the modal, show a fullscreen drag-to-select overlay, and feed
  // the chosen rectangle into captureScreenshot(region).
  const [regionPicking, setRegionPicking] = useState(false);

  // Clamp selection if the array shrinks beneath the current index.
  const safeSelectedIdx =
    shots.length === 0 ? -1 : Math.min(selectedShotIdx, shots.length - 1);
  const currentShot = safeSelectedIdx >= 0 ? shots[safeSelectedIdx] : null;

  // Drag state for the floating trigger. `dragPos` null = use default
  // Tailwind corner positioning; once set, we pin via inline left/top so
  // the user can park the button anywhere it's not blocking other UI
  // (e.g. the chat input). Position persists in localStorage per corner
  // so page reloads don't reset it.
  const DRAG_STORAGE_KEY = `blip-issue-reporter-pos-${position}`;
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    moved: boolean;
  } | null>(null);
  // Set for one tick after a drag-release so the synthetic click that
  // follows pointerup doesn't open the modal.
  const justDraggedRef = useRef(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Dedicated picker for the "Upload" capture mode — kept separate from
  // the attachments file input so the accept= filter and validation
  // (image-only, ≤ 5MB, ≤ MAX_SCREENSHOTS) don't bleed across.
  const screenshotInputRef = useRef<HTMLInputElement | null>(null);

  // Expose this instance's open() globally so external triggers (e.g.
  // a header icon) can open the reporter. Gated by `authed` so logged-
  // out sessions can't programmatically open it.
  useEffect(() => {
    if (!authed) return;
    openIssueReporterGlobal = reporter.open;
    return () => {
      if (openIssueReporterGlobal === reporter.open) {
        openIssueReporterGlobal = null;
      }
    };
  }, [authed, reporter.open]);

  const resetForm = useCallback(() => {
    setTitle("");
    setCategory("ui_bug");
    setDescription("");
    setShots([]);
    setSelectedShotIdx(0);
    setAttachments([]);
  }, []);

  /**
   * Append a new entry to the shot list and select it. Caps at
   * MAX_SCREENSHOTS — over-cap calls toast and no-op so the user
   * understands why nothing happened. Returns the new entry's index
   * (or -1 if at cap) for callers that want to chain follow-up work.
   */
  const addShot = useCallback(
    (
      source: string,
      type: ShotEntry["type"],
      meta?: { mime?: string; size_bytes?: number },
    ): number => {
      let appendedIdx = -1;
      setShots((prev) => {
        if (prev.length >= MAX_SCREENSHOTS) {
          setToast({
            variant: "error",
            message: `Max ${MAX_SCREENSHOTS} screenshots — remove one to add another`,
          });
          return prev;
        }
        const next: ShotEntry[] = [
          ...prev,
          {
            id: newShotId(),
            source,
            annotated: null,
            type,
            ...(meta?.mime ? { mime: meta.mime } : {}),
            ...(typeof meta?.size_bytes === "number"
              ? { size_bytes: meta.size_bytes }
              : {}),
          },
        ];
        appendedIdx = next.length - 1;
        return next;
      });
      // Auto-select the new shot so the annotator switches to it.
      setSelectedShotIdx((prevIdx) =>
        appendedIdx >= 0 ? appendedIdx : prevIdx,
      );
      return appendedIdx;
    },
    [],
  );

  const removeShot = useCallback((idx: number) => {
    setShots((prev) => {
      if (idx < 0 || idx >= prev.length) return prev;
      const next = prev.slice(0, idx).concat(prev.slice(idx + 1));
      return next;
    });
    setSelectedShotIdx((prev) => {
      // Shift the selected index left if we removed something at or
      // before it. Clamp into the new bounds.
      if (idx < prev) return Math.max(0, prev - 1);
      return prev;
    });
  }, []);

  const updateAnnotation = useCallback(
    (idx: number, annotatedDataUrl: string) => {
      setShots((prev) => {
        if (idx < 0 || idx >= prev.length) return prev;
        if (prev[idx].annotated === annotatedDataUrl) return prev;
        const next = prev.slice();
        next[idx] = { ...next[idx], annotated: annotatedDataUrl };
        return next;
      });
    },
    [],
  );

  // Seed with the pre-captured open() shot — but only on the very first
  // open of this session. After that, the user owns the list.
  const initialShotConsumedRef = useRef(false);
  useEffect(() => {
    if (!reporter.isOpen) {
      // Reset the consumption flag when the modal closes so the next
      // open() seeds again.
      initialShotConsumedRef.current = false;
      return;
    }
    if (initialShotConsumedRef.current) return;
    if (shots.length > 0) {
      initialShotConsumedRef.current = true;
      return;
    }
    if (reporter.initialShot) {
      initialShotConsumedRef.current = true;
      addShot(reporter.initialShot, "screenshot");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reporter.isOpen, reporter.initialShot]);

  const handleRecapture = useCallback(async () => {
    if (shots.length >= MAX_SCREENSHOTS) {
      setToast({
        variant: "error",
        message: `Max ${MAX_SCREENSHOTS} screenshots — remove one to add another`,
      });
      return;
    }
    const shot = await reporter.captureScreenshot();
    if (shot) addShot(shot, "screenshot");
  }, [reporter, shots.length, addShot]);

  /**
   * Region mode: hide the current modal, mount the RegionSelector, wait
   * for the user to drag-select a rectangle, then capture that region
   * only. The modal stays in the DOM under the selector (with its own
   * data-issue-reporter-root attribute, which the screenshot filter
   * strips out of the capture anyway) so the user's in-flight form
   * inputs are preserved.
   */
  const handleRegionCapture = useCallback(() => {
    if (shots.length >= MAX_SCREENSHOTS) {
      setToast({
        variant: "error",
        message: `Max ${MAX_SCREENSHOTS} screenshots — remove one to add another`,
      });
      return;
    }
    setRegionPicking(true);
  }, [shots.length]);

  const handleRegionPicked = useCallback(
    async (region: Region) => {
      setRegionPicking(false);
      // Wait a frame so the overlay is fully unmounted before we
      // capture — otherwise its selection rectangle could leak into
      // the snapshot.
      await new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      );
      const shot = await reporter.captureScreenshot(region);
      if (shot) addShot(shot, "screenshot");
    },
    [reporter, addShot],
  );

  const handleRegionCancel = useCallback(() => {
    setRegionPicking(false);
  }, []);

  /**
   * Manual upload mode. Reads the picked file as a dataUrl and adds it
   * to shots[] with type='upload' so the API/admin can render it as a
   * user-supplied image instead of an in-app capture.
   */
  const handleScreenshotPick = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      e.target.value = "";
      for (const file of files) {
        if (shots.length >= MAX_SCREENSHOTS) {
          setToast({
            variant: "error",
            message: `Max ${MAX_SCREENSHOTS} screenshots — remove one to add another`,
          });
          break;
        }
        if (!file.type.startsWith("image/")) {
          setToast({
            variant: "error",
            message: `"${file.name}" is not an image`,
          });
          continue;
        }
        if (file.size > MAX_SCREENSHOT_BYTES) {
          setToast({
            variant: "error",
            message: `"${file.name}" exceeds 5MB limit`,
          });
          continue;
        }
        const dataUrl = await new Promise<string | null>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(file);
        });
        if (!dataUrl) continue;
        addShot(dataUrl, "upload", {
          mime: file.type || undefined,
          size_bytes: file.size,
        });
      }
    },
    [shots.length, addShot],
  );

  // Restore saved drag position on mount. Clamp to the current viewport
  // in case the user resized the window since last session — otherwise
  // the button could end up off-screen.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(DRAG_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed.x === "number" &&
        typeof parsed.y === "number"
      ) {
        const x = Math.min(Math.max(0, parsed.x), window.innerWidth - 40);
        const y = Math.min(Math.max(0, parsed.y), window.innerHeight - 40);
        setDragPos({ x, y });
      }
    } catch {
      // ignore — corrupted value, fall back to default corner
    }
  }, [DRAG_STORAGE_KEY]);

  const handleTriggerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      dragStateRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: rect.left,
        origY: rect.top,
        moved: false,
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore — some browsers reject capture on non-primary pointers
      }
    },
    [],
  );

  const handleTriggerPointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const state = dragStateRef.current;
      if (!state) return;
      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;
      // 4px threshold keeps small tremors from turning a click into a drag
      if (!state.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      state.moved = true;
      const btn = e.currentTarget;
      const w = btn.offsetWidth;
      const h = btn.offsetHeight;
      const nextX = Math.min(
        Math.max(0, state.origX + dx),
        window.innerWidth - w,
      );
      const nextY = Math.min(
        Math.max(0, state.origY + dy),
        window.innerHeight - h,
      );
      setDragPos({ x: nextX, y: nextY });
    },
    [],
  );

  const handleTriggerPointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const state = dragStateRef.current;
      dragStateRef.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      if (state?.moved) {
        justDraggedRef.current = true;
        // Clear the flag after the click event fires (next task).
        setTimeout(() => {
          justDraggedRef.current = false;
        }, 0);
        const rect = e.currentTarget.getBoundingClientRect();
        try {
          window.localStorage.setItem(
            DRAG_STORAGE_KEY,
            JSON.stringify({ x: rect.left, y: rect.top }),
          );
        } catch {
          // ignore — storage may be disabled (private mode, quota)
        }
      }
    },
    [DRAG_STORAGE_KEY],
  );

  const handleTriggerClick = useCallback(() => {
    if (justDraggedRef.current) return;
    void reporter.open();
  }, [reporter]);

  const ingestFiles = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        if (attachments.length >= MAX_ATTACHMENTS) break;
        if (file.size > MAX_ATTACHMENT_BYTES) {
          setToast({
            variant: "error",
            message: `"${file.name}" exceeds 25MB limit`,
          });
          continue;
        }
        const dataUrl = await new Promise<string | null>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(file);
        });
        if (!dataUrl) continue;
        setAttachments((prev) =>
          prev.length >= MAX_ATTACHMENTS
            ? prev
            : [
                ...prev,
                {
                  name: file.name,
                  dataUrl,
                  mime: file.type || "application/octet-stream",
                  size: file.size,
                },
              ],
        );
      }
    },
    [attachments.length],
  );

  const handleFilePick = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      e.target.value = "";
      await ingestFiles(files);
    },
    [ingestFiles],
  );

  const handleSubmit = useCallback(async () => {
    if (!title.trim()) {
      setToast({ variant: "error", message: "Title is required" });
      return;
    }
    if (!description.trim()) {
      setToast({ variant: "error", message: "Description is required" });
      return;
    }
    // Build the v2 screenshots[] payload from shots, preferring the
    // annotated overlay when present. screenshotDataUrl is left null
    // because the v2 list is the canonical source — the hook still
    // accepts it for legacy callers but we no longer populate it here.
    const screenshotsPayload = shots.map((s) => ({
      dataUrl: s.annotated || s.source,
      type: s.type,
      ...(s.mime ? { mime: s.mime } : {}),
      ...(typeof s.size_bytes === "number"
        ? { size_bytes: s.size_bytes }
        : {}),
    }));
    const result = await reporter.submit({
      title: title.trim(),
      category,
      description: description.trim(),
      screenshotDataUrl: null,
      screenshots: screenshotsPayload,
      attachments,
    });
    if (result.ok) {
      setToast({
        variant: "success",
        message: `Issue submitted${result.issueId ? ` (#${result.issueId.slice(0, 8)})` : ""}`,
      });
      resetForm();
      setTimeout(() => {
        reporter.close();
        setToast(null);
      }, 1200);
    } else {
      setToast({
        variant: "error",
        message: result.error || "Failed to submit",
      });
    }
  }, [
    title,
    description,
    category,
    shots,
    attachments,
    reporter,
    resetForm,
  ]);

  const positionClasses =
    position === "bottom-left" ? "left-4 bottom-4" : "right-4 bottom-4";

  // Gate behind login — the Report Issue button (and modal) only render
  // once a merchant session is active.
  if (!authed) return null;

  return (
    <>
      {/* Floating trigger. Shows a "Capturing…" state while the
          pre-open screenshot is being taken — important, since that
          can take 500ms+ on heavy pages and the user would otherwise
          wonder if the click registered. */}
      {!reporter.isOpen && !hideTrigger && (
        <button
          type="button"
          onClick={handleTriggerClick}
          onPointerDown={handleTriggerPointerDown}
          onPointerMove={handleTriggerPointerMove}
          onPointerUp={handleTriggerPointerUp}
          onPointerCancel={handleTriggerPointerUp}
          disabled={reporter.capturingShot}
          style={
            dragPos
              ? { left: `${dragPos.x}px`, top: `${dragPos.y}px`, touchAction: "none" }
              : { touchAction: "none" }
          }
          className={`fixed ${dragPos ? "" : positionClasses} z-[60] flex items-center gap-2 px-3.5 py-2 rounded-full
                      bg-amber-500 text-black text-[12px] font-semibold cursor-grab active:cursor-grabbing select-none
                      shadow-lg shadow-amber-500/20 hover:bg-amber-400 transition
                      disabled:opacity-80 disabled:cursor-wait`}
          title="Report Issue (Ctrl+Shift+I) — drag to move"
          data-issue-reporter-trigger
        >
          {reporter.capturingShot ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Capturing…
            </>
          ) : (
            <>
              <Bug size={14} />
              {triggerLabel}
            </>
          )}
        </button>
      )}

      {/* Global capture toast. Rendered OUTSIDE the modal conditional
          so it paints the instant `capturingShot` flips to true — even
          if the modal itself takes a frame or two to mount on slower
          devices. This is the "something is happening" signal users
          look for right after clicking.

          Tagged `data-issue-reporter-root` so the screenshot capture
          filter strips it out (otherwise the toast would appear in
          the snapshot). */}
      {reporter.capturingShot && (
        <div
          data-issue-reporter-root
          role="status"
          aria-live="assertive"
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[90] flex items-center gap-2.5 px-4 py-2.5 rounded-full
                     bg-amber-500 text-black text-[12px] font-semibold
                     shadow-xl shadow-amber-500/30 animate-[pulse_2s_ease-in-out_infinite]"
        >
          <Loader2 size={14} className="animate-spin" />
          <span>
            Preparing your issue report — capturing screen, please wait…
          </span>
        </div>
      )}

      {reporter.isOpen && regionPicking && (
        <RegionSelector
          onSelect={handleRegionPicked}
          onCancel={handleRegionCancel}
        />
      )}

      {reporter.isOpen && (
        <div
          data-issue-reporter-root
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          style={regionPicking ? { visibility: "hidden" } : undefined}
          onClick={(e) => {
            if (e.target === e.currentTarget) reporter.close();
          }}
        >
          <div className="w-full max-w-6xl h-[88vh] max-h-[780px] bg-background border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div>
                <div className="text-[18px] font-semibold leading-tight">
                  Create Issue
                </div>
                <div className="text-[12px] text-foreground/50 mt-0.5">
                  Capture and highlight the issue
                </div>
              </div>
              <button
                type="button"
                onClick={reporter.close}
                disabled={reporter.submitting}
                className="p-1.5 rounded-md hover:bg-foreground/[0.05] disabled:opacity-40"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {/* Capture-in-progress banner. Spans the full width of the
                modal so the user sees it no matter which side of the
                two-column body they're looking at. Auto-hides the
                instant the screenshot lands in the annotator. */}
            {reporter.capturingShot && (
              <div
                role="status"
                aria-live="polite"
                className="flex items-center gap-2.5 px-6 py-2.5 bg-amber-500/10 border-b border-amber-400/30 text-[12px] text-amber-200"
              >
                <Loader2 size={14} className="animate-spin shrink-0" />
                <div className="min-w-0 flex-1">
                  <span className="font-medium">
                    Capturing your screen…
                  </span>{" "}
                  <span className="text-amber-200/80">
                    This can take a few seconds on large pages. You can
                    start filling out the issue details while it finishes.
                  </span>
                </div>
              </div>
            )}

            {/* Body (two columns) */}
            <div className="flex-1 flex min-h-0">
              {/* ── Left column — screenshot + annotation ────────────── */}
              <div className="w-[62%] border-r border-border flex flex-col bg-foreground/[0.015]">
                {/* Hidden screenshot file picker for the "Upload" mode.
                    Separate from the attachments picker so the accept
                    filter and 5MB cap stay scoped to image uploads. */}
                <input
                  ref={screenshotInputRef}
                  type="file"
                  accept={SCREENSHOT_ACCEPTED_MIMES}
                  multiple
                  className="hidden"
                  onChange={handleScreenshotPick}
                />

                <div className="flex-1 min-h-0 px-5 pt-4 pb-2 flex flex-col">
                  {/* Annotation canvas OR states. The annotator is keyed
                      by the selected shot's id so React fully unmounts
                      and remounts when the user switches shots —
                      otherwise the previous shot's annotation state
                      would bleed into the new image. */}
                  <div className="flex-1 min-h-0 rounded-lg border border-border bg-black/40 overflow-hidden">
                    {currentShot ? (
                      <IssueAnnotator
                        key={currentShot.id}
                        source={currentShot.source}
                        onExport={(dataUrl) => {
                          if (safeSelectedIdx >= 0) {
                            updateAnnotation(safeSelectedIdx, dataUrl);
                          }
                        }}
                      />
                    ) : reporter.capturingShot ? (
                      <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center">
                        <div className="relative">
                          <div className="absolute inset-0 rounded-full bg-amber-500/20 animate-ping" />
                          <div className="relative flex items-center justify-center h-10 w-10 rounded-full bg-amber-500/15 border border-amber-400/40">
                            <Loader2 size={18} className="animate-spin text-amber-300" />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <div className="text-[13px] font-medium text-amber-200">
                            Capturing your screen…
                          </div>
                          <div className="text-[11px] text-foreground/50 max-w-xs">
                            This can take a few seconds. Feel free to start
                            filling in the issue details on the right — the
                            screenshot will show up here when it&apos;s ready.
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center gap-2 text-[12px] text-foreground/50 p-6 text-center">
                        <div className="font-medium">
                          No screenshots attached
                        </div>
                        {reporter.captureError ? (
                          <div className="text-amber-300/80 max-w-md">
                            {reporter.captureError}
                          </div>
                        ) : (
                          <div className="text-foreground/40">
                            Use Full / Region / Upload below to add up to{" "}
                            {MAX_SCREENSHOTS}.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Thumbnail strip — only shown once the user has at
                    least one shot. Click a thumb to switch the
                    annotator to that shot; X removes it. */}
                {shots.length > 0 && (
                  <div className="px-4 py-2 border-t border-border flex items-center gap-2 overflow-x-auto">
                    {shots.map((shot, idx) => {
                      const isSelected = idx === safeSelectedIdx;
                      const preview = shot.annotated || shot.source;
                      return (
                        <div
                          key={shot.id}
                          className={`relative shrink-0 w-14 h-14 rounded-md overflow-hidden border transition group ${
                            isSelected
                              ? "border-amber-400 ring-2 ring-amber-400/30"
                              : "border-border hover:border-foreground/30"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedShotIdx(idx)}
                            className="absolute inset-0"
                            title={`Screenshot ${idx + 1} of ${shots.length} — ${shot.type === "upload" ? "uploaded" : "captured"}`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={preview}
                              alt={`Screenshot ${idx + 1}`}
                              className="w-full h-full object-cover"
                            />
                          </button>
                          {/* Type badge: tiny dot for upload vs capture */}
                          <span
                            className={`absolute bottom-0.5 left-0.5 px-1 py-px rounded text-[8px] leading-none font-mono uppercase tracking-wide ${
                              shot.type === "upload"
                                ? "bg-sky-500/80 text-white"
                                : "bg-amber-500/80 text-black"
                            }`}
                          >
                            {shot.type === "upload" ? "U" : "C"}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeShot(idx);
                            }}
                            className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                            title="Remove"
                            aria-label="Remove screenshot"
                          >
                            <X size={10} />
                          </button>
                        </div>
                      );
                    })}
                    {/* Counter slot — quick visual cap awareness */}
                    <div className="text-[10px] text-foreground/40 font-mono shrink-0 ml-1">
                      {shots.length}/{MAX_SCREENSHOTS}
                    </div>
                  </div>
                )}

                {/* Footer row — tip + capture mode picker */}
                <div className="flex items-center justify-between px-4 py-2 border-t border-border gap-3">
                  <div className="flex items-center gap-1.5 text-[11px] text-foreground/50 min-w-0">
                    <Sparkles size={11} className="text-amber-400 shrink-0" />
                    <span className="truncate">
                      Tip: Select and drag shapes, press Delete to remove.
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 p-0.5 rounded-md bg-foreground/[0.04] border border-border">
                    <button
                      type="button"
                      onClick={handleRecapture}
                      disabled={
                        reporter.capturingShot ||
                        regionPicking ||
                        shots.length >= MAX_SCREENSHOTS
                      }
                      className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-foreground/75 hover:bg-foreground/[0.08] hover:text-foreground/95 disabled:opacity-40 disabled:cursor-wait transition"
                      title={
                        shots.length >= MAX_SCREENSHOTS
                          ? `Max ${MAX_SCREENSHOTS} screenshots`
                          : "Capture full page"
                      }
                    >
                      {reporter.capturingShot && !regionPicking ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <Monitor size={11} />
                      )}
                      Full
                    </button>
                    <button
                      type="button"
                      onClick={handleRegionCapture}
                      disabled={
                        reporter.capturingShot ||
                        regionPicking ||
                        shots.length >= MAX_SCREENSHOTS
                      }
                      className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-foreground/75 hover:bg-foreground/[0.08] hover:text-foreground/95 disabled:opacity-40 transition"
                      title={
                        shots.length >= MAX_SCREENSHOTS
                          ? `Max ${MAX_SCREENSHOTS} screenshots`
                          : "Drag to select a region"
                      }
                    >
                      <Crop size={11} />
                      Region
                    </button>
                    <button
                      type="button"
                      onClick={() => screenshotInputRef.current?.click()}
                      disabled={
                        reporter.capturingShot ||
                        regionPicking ||
                        shots.length >= MAX_SCREENSHOTS
                      }
                      className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-foreground/75 hover:bg-foreground/[0.08] hover:text-foreground/95 disabled:opacity-40 transition"
                      title={
                        shots.length >= MAX_SCREENSHOTS
                          ? `Max ${MAX_SCREENSHOTS} screenshots`
                          : "Upload an image (PNG, JPG, WEBP, ≤ 5MB)"
                      }
                    >
                      <Upload size={11} />
                      Upload
                    </button>
                  </div>
                </div>
              </div>

              {/* ── Right column — form ────────────────────────────── */}
              <div className="w-[38%] flex flex-col">
                <div className="flex-1 min-h-0 overflow-auto px-5 py-4 space-y-4">
                  <div className="text-[13px] font-semibold">Issue Details</div>

                  <div>
                    <label className="block text-[11px] font-medium text-foreground/60 mb-1">
                      Title <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      maxLength={200}
                      placeholder="e.g. Order not appearing after payment"
                      className="w-full px-3 py-2 rounded-md bg-foreground/[0.04] border border-border text-[13px] focus:outline-none focus:border-amber-400/60"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-foreground/60 mb-1">
                      Category <span className="text-rose-400">*</span>
                    </label>
                    <select
                      value={category}
                      onChange={(e) =>
                        setCategory(e.target.value as IssueCategory)
                      }
                      className="w-full px-3 py-2 rounded-md bg-foreground/[0.04] border border-border text-[13px] focus:outline-none focus:border-amber-400/60"
                    >
                      {ISSUE_CATEGORIES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-foreground/60 mb-1">
                      Description <span className="text-rose-400">*</span>
                    </label>
                    <div className="relative">
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        maxLength={500}
                        rows={5}
                        placeholder={`Describe the issue clearly:
                          • What happened?
                          • When did it happen?
                          • What did you expect?
                          
                          Example: I placed an order at ₹500, but it is not showing in pending orders after payment.`}
                        className="w-full px-3 py-2 pb-5 rounded-md bg-foreground/[0.04] border border-border text-[13px] focus:outline-none focus:border-amber-400/60 resize-none"
                      />
                      <div className="absolute bottom-1.5 right-2 text-[10px] text-foreground/40 font-mono">
                        {description.length}/500
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-foreground/60 mb-1">
                      Attachments{" "}
                      <span className="text-foreground/30 font-normal">
                        (Optional)
                      </span>
                    </label>
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragActive(true);
                      }}
                      onDragLeave={() => setDragActive(false)}
                      onDrop={async (e) => {
                        e.preventDefault();
                        setDragActive(false);
                        const files = Array.from(e.dataTransfer.files || []);
                        await ingestFiles(files);
                      }}
                      onClick={() => fileInputRef.current?.click()}
                      className={`rounded-lg border-2 border-dashed px-4 py-6 text-center cursor-pointer transition ${
                        dragActive
                          ? "border-amber-400 bg-amber-400/5"
                          : "border-border bg-foreground/[0.02] hover:border-foreground/30 hover:bg-foreground/[0.04]"
                      }`}
                    >
                      <CloudUpload
                        size={22}
                        className="mx-auto text-foreground/50 mb-1.5"
                      />
                      <div className="text-[13px] font-medium">
                        Upload files
                      </div>
                      <div className="text-[11px] text-foreground/40 mt-0.5">
                        Images, Videos or Logs (Max 25MB)
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept={ACCEPTED_MIMES}
                        multiple
                        className="hidden"
                        onChange={handleFilePick}
                      />
                    </div>
                    {attachments.length > 0 && (
                      <ul className="space-y-1 mt-2">
                        {attachments.map((a, i) => (
                          <li
                            key={`${a.name}-${i}`}
                            className="flex items-center gap-2 px-2 py-1 rounded bg-foreground/[0.04] text-[11px]"
                          >
                            <Paperclip
                              size={11}
                              className="text-foreground/40"
                            />
                            <span className="flex-1 truncate">{a.name}</span>
                            <span className="text-foreground/40">
                              {(a.size / 1024).toFixed(0)}KB
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setAttachments((prev) =>
                                  prev.filter((_, idx) => idx !== i),
                                );
                              }}
                              className="p-0.5 rounded hover:bg-foreground/[0.08]"
                              aria-label="Remove"
                            >
                              <X size={10} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {toast && (
                    <div
                      className={`px-3 py-2 rounded-md text-[12px] border ${
                        toast.variant === "success"
                          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
                          : "bg-rose-500/10 border-rose-500/20 text-rose-300"
                      }`}
                    >
                      {toast.message}
                    </div>
                  )}
                </div>

                {/* Form footer — actions + tagline */}
                <div className="border-t border-border">
                  <div className="flex items-center justify-end gap-2 px-5 pt-3 pb-2">
                    <button
                      type="button"
                      onClick={reporter.close}
                      disabled={reporter.submitting}
                      className="px-4 py-2 rounded-md text-[12px] font-medium bg-foreground/[0.05] hover:bg-foreground/[0.09] disabled:opacity-40"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={
                        reporter.submitting ||
                        !title.trim() ||
                        !description.trim()
                      }
                      className="flex items-center gap-1.5 px-4 py-2 rounded-md text-[12px] font-semibold bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-40 disabled:hover:bg-amber-500"
                    >
                      {reporter.submitting ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Send size={12} />
                      )}
                      {reporter.submitting ? "Submitting…" : "Submit Issue"}
                    </button>
                  </div>
                  <div className="flex items-center justify-center gap-1 px-5 pb-3 text-[10px] text-foreground/40">
                    <Lock size={9} />
                    Your feedback helps us improve Blip.money
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

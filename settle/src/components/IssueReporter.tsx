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
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [annotatedScreenshot, setAnnotatedScreenshot] = useState<string | null>(
    null,
  );
  const [attachments, setAttachments] = useState<AttachmentInput[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const [dragActive, setDragActive] = useState(false);
  // Region-capture mode: when the user picks "Region", we temporarily
  // hide the modal, show a fullscreen drag-to-select overlay, and feed
  // the chosen rectangle into captureScreenshot(region).
  const [regionPicking, setRegionPicking] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
    setScreenshot(null);
    setAnnotatedScreenshot(null);
    setAttachments([]);
  }, []);

  // Seed the preview with the pre-captured shot that open() took before
  // the modal mounted (per the capture spec: "Screenshot must be taken
  // before opening the issue modal"). If it's missing (e.g. capture
  // failed pre-open), the user can still click Retake inside the modal.
  useEffect(() => {
    if (!reporter.isOpen) return;
    if (screenshot || annotatedScreenshot) return;
    if (reporter.initialShot) {
      setScreenshot(reporter.initialShot);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reporter.isOpen, reporter.initialShot]);

  const handleRecapture = useCallback(async () => {
    setScreenshot(null);
    setAnnotatedScreenshot(null);
    const shot = await reporter.captureScreenshot();
    if (shot) setScreenshot(shot);
  }, [reporter]);

  /**
   * Region mode: hide the current modal, mount the RegionSelector, wait
   * for the user to drag-select a rectangle, then capture that region
   * only. The modal stays in the DOM under the selector (with its own
   * data-issue-reporter-root attribute, which the screenshot filter
   * strips out of the capture anyway) so the user's in-flight form
   * inputs are preserved.
   */
  const handleRegionCapture = useCallback(() => {
    setScreenshot(null);
    setAnnotatedScreenshot(null);
    setRegionPicking(true);
  }, []);

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
      if (shot) setScreenshot(shot);
    },
    [reporter],
  );

  const handleRegionCancel = useCallback(() => {
    setRegionPicking(false);
  }, []);

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
    const result = await reporter.submit({
      title: title.trim(),
      category,
      description: description.trim(),
      screenshotDataUrl: annotatedScreenshot || screenshot,
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
    screenshot,
    annotatedScreenshot,
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
          onClick={() => void reporter.open()}
          disabled={reporter.capturingShot}
          className={`fixed ${positionClasses} z-[60] flex items-center gap-2 px-3.5 py-2 rounded-full
                      bg-amber-500 text-black text-[12px] font-semibold
                      shadow-lg shadow-amber-500/20 hover:bg-amber-400 active:scale-[0.98] transition
                      disabled:opacity-80 disabled:cursor-wait`}
          title="Report Issue (Ctrl+Shift+I)"
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
                <div className="flex-1 min-h-0 px-5 pt-4 pb-2 flex flex-col">
                  {/* Annotation canvas OR states */}
                  <div className="flex-1 min-h-0 rounded-lg border border-border bg-black/40 overflow-hidden">
                    {screenshot ? (
                      <IssueAnnotator
                        source={screenshot}
                        onExport={(dataUrl) => setAnnotatedScreenshot(dataUrl)}
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
                          No screenshot attached
                        </div>
                        {reporter.captureError ? (
                          <div className="text-amber-300/80 max-w-md">
                            {reporter.captureError}
                          </div>
                        ) : (
                          <div className="text-foreground/40">
                            You can still submit without one.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

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
                      disabled={reporter.capturingShot || regionPicking}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-foreground/75 hover:bg-foreground/[0.08] hover:text-foreground/95 disabled:opacity-40 disabled:cursor-wait transition"
                      title="Capture full page"
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
                      disabled={reporter.capturingShot || regionPicking}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-foreground/75 hover:bg-foreground/[0.08] hover:text-foreground/95 disabled:opacity-40 transition"
                      title="Drag to select a region"
                    >
                      <Crop size={11} />
                      Region
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

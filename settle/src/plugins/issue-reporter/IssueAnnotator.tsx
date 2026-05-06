"use client";

/**
 * <IssueAnnotator /> — screenshot annotation layer (react-konva).
 *
 * Architecture:
 *   - Shapes are React state (array of typed Shape objects). Every
 *     mutation goes through one of: addShape / updateShape / deleteShape
 *     / setShapes. Konva renders from that state — there is NO imperative
 *     scene graph, which is what made the old fabric.js impl so brittle.
 *   - The captured screenshot is rendered as a Konva Image on the bottom
 *     Layer. The annotation shapes live on a separate top Layer so we
 *     can hit-test them independently.
 *   - Undo/Redo stores full `Shape[]` snapshots — small (~1KB per
 *     annotation) and dead-simple to reason about.
 *   - A Transformer attaches to the currently-selected shape so the user
 *     gets drag + resize handles without any custom hit-testing code.
 *   - Export composites the screenshot + stage into a single JPEG via
 *     stage.toCanvas().
 *
 * Why dynamic import:
 *   Konva touches `window` at module-load time on some code paths.
 *   Wrapping in `next/dynamic({ ssr: false })` guarantees we never try
 *   to resolve it during Next.js SSR. The inner component is where all
 *   the real logic lives.
 */

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

export interface IssueAnnotatorProps {
  source: string;
  onExport: (dataUrl: string) => void;
}

const IssueAnnotatorInner = dynamic(
  () =>
    import("./IssueAnnotatorInner").then((mod) => mod.IssueAnnotatorInner),
  {
    ssr: false,
    loading: () => (
      <div className="h-full flex items-center justify-center text-[12px] text-foreground/50">
        <Loader2 size={14} className="animate-spin mr-2" />
        Loading annotator…
      </div>
    ),
  },
);

export function IssueAnnotator(props: IssueAnnotatorProps) {
  return <IssueAnnotatorInner {...props} />;
}

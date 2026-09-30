import {
  useCallback,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

export interface UsePanelResizeOptions {
  /** Starting width in px. */
  initial: number;
  /** Minimum width in px. Default 140. */
  min?: number;
  /** Maximum width in px. Default 480. */
  max?: number;
  /** Which edge the drag handle sits on. `right` grows the panel as you drag right (left-docked panel); `left` grows it as you drag left (right-docked panel). Default `right`. */
  side?: "left" | "right";
  /** CSS custom property the panel width is published on (e.g. `--log-left-w`). Read it in your grid template / panel width. */
  cssVar: string;
  /** Ref to the element the CSS variable is written to during a drag (the layout container). */
  containerRef: RefObject<HTMLElement | null>;
}

export interface PanelResize {
  /** Committed width in px (updates once per drag, on release). */
  width: number;
  /** Imperatively set the committed width. */
  setWidth: (width: number) => void;
  /** Begin a drag from a pointer-down on the handle. */
  onResizeStart: (e: ReactPointerEvent) => void;
  /** Style object publishing the CSS variable — spread onto the container. */
  style: CSSProperties;
}

/**
 * Pointer-driven panel resize. During a drag the width is written straight to a CSS
 * custom property on `containerRef` (no React re-render per frame); the committed
 * `width` state updates only on release. Pair with {@link PanelResizeHandle}.
 */
export function usePanelResize({
  initial,
  min = 140,
  max = 480,
  side = "right",
  cssVar,
  containerRef,
}: UsePanelResizeOptions): PanelResize {
  const [width, setWidth] = useState(initial);

  const onResizeStart = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;

      const startX = e.clientX;
      const startWidth = width;
      const dir = side === "right" ? 1 : -1;
      const clamp = (w: number) => Math.min(max, Math.max(min, w));

      const compute = (clientX: number) => clamp(startWidth + dir * (clientX - startX));

      const onMove = (ev: PointerEvent) => {
        container.style.setProperty(cssVar, `${compute(ev.clientX)}px`);
      };
      const onUp = (ev: PointerEvent) => {
        setWidth(Math.round(compute(ev.clientX)));
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    },
    [containerRef, width, side, cssVar, min, max]
  );

  return { width, setWidth, onResizeStart, style: { [cssVar]: `${width}px` } as CSSProperties };
}

export interface PanelResizeHandleProps {
  onResizeStart: (e: ReactPointerEvent) => void;
  /** Extra positioning classes — the consumer places the handle on the relevant edge. */
  className?: string;
  style?: CSSProperties;
}

/** A thin draggable column-resize bar. Position it on the panel edge via `className`/`style`. */
export function PanelResizeHandle({ onResizeStart, className = "", style }: PanelResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      className={`group w-1.5 cursor-col-resize touch-none select-none ${className}`}
      style={style}
      onPointerDown={onResizeStart}
    >
      {/* visible hairline, thickens/tints on hover */}
      <div className="mx-auto h-full w-px bg-transparent transition-colors group-hover:w-0.5 group-hover:bg-(--primary)" />
    </div>
  );
}

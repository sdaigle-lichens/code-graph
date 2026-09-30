import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

export interface ToastOptions {
  variant?: "success" | "error" | "warning";
  /** Auto-dismiss delay in ms. 0 keeps it until manually closed. Default 4000. */
  duration?: number;
}

interface ToastItem {
  id: number;
  message: ReactNode;
  variant: "success" | "error" | "warning";
}

// ── Module-level store ─────────────────────────────────────────────
// Imperative: routes call `toast(...)` directly, a single <Toaster /> renders.
let items: ToastItem[] = [];
const listeners = new Set<() => void>();
let nextId = 1;

function emit() {
  for (const l of listeners) l();
}

function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

export function toast(message: ReactNode, opts: ToastOptions = {}) {
  const id = nextId++;
  items = [...items, { id, message, variant: opts.variant ?? "success" }];
  emit();
  const duration = opts.duration ?? 4000;
  if (typeof window !== "undefined" && duration > 0) {
    window.setTimeout(() => dismiss(id), duration);
  }
  return id;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot() {
  return items;
}

const EMPTY: ToastItem[] = [];
function getServerSnapshot() {
  return EMPTY;
}

// ── Components ─────────────────────────────────────────────────────
function ToastCard({ item }: { item: ToastItem }) {
  const isError = item.variant === "error";
  const isWarning = item.variant === "warning";
  return (
    <div
      role="status"
      className="pointer-events-auto flex items-start gap-2.5 w-[340px] max-w-[90vw] px-3.5 py-3 rounded-[12px] border border-(--line) bg-(--bg-elev) shadow-[0_16px_40px_rgba(0,0,0,.22)] [animation:csRiseIn_.25s_ease-out]"
    >
      <div
        className={`mt-px shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${
          isError
            ? "bg-red-500/15 text-red-500"
            : isWarning
              ? "bg-amber-500/15 text-amber-500"
              : "bg-(--primary-dim) text-(--primary)"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          width={13}
          height={13}
          aria-hidden
          fill="none"
          stroke="currentColor"
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {isError && <path d="M6 6l12 12M18 6L6 18" />}
          {isWarning && (
            <path d="M12 9v4m0 3.5h.01M10.3 4.3 2.6 18a1.5 1.5 0 0 0 1.3 2.2h16.2a1.5 1.5 0 0 0 1.3-2.2L13.7 4.3a1.5 1.5 0 0 0-2.6 0Z" />
          )}
          {!isError && !isWarning && <path d="M5 12l5 5L20 7" />}
        </svg>
      </div>
      <p className="m-0 text-[13px] leading-snug text-(--ink-2) flex-1">{item.message}</p>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismiss(item.id)}
        className="shrink-0 p-0.5 -mr-1 rounded text-(--ink-3) cursor-pointer hover:text-(--ink) focus:outline-none"
      >
        <svg
          viewBox="0 0 24 24"
          width={13}
          height={13}
          aria-hidden
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}

export function Toaster() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div className="fixed bottom-5 right-5 z-[80] flex flex-col gap-2.5 items-end pointer-events-none">
      {snapshot.map((t) => (
        <ToastCard key={t.id} item={t} />
      ))}
    </div>,
    document.body
  );
}

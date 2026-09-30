import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useRef } from "react";

interface SlidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  side: "left" | "right";
  widthClass?: string;
  toggleDataAttr?: string | string[];
  children: React.ReactNode;
  className?: string;
}

export default function SlidePanel({
  isOpen,
  onClose,
  side,
  widthClass = "w-64",
  toggleDataAttr,
  children,
  className = "",
}: SlidePanelProps) {
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function onMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      const attrs = Array.isArray(toggleDataAttr) ? toggleDataAttr : toggleDataAttr ? [toggleDataAttr] : [];
      if (attrs.some((attr) => target.closest(`[${attr}]`))) return;
      if (popupRef.current && !popupRef.current.contains(target)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [isOpen, onClose, toggleDataAttr]);

  const borderClass = side === "left" ? "left-0 border-r" : "right-0 border-l";
  const animClass =
    side === "left"
      ? "data-[starting-style]:-translate-x-full data-[ending-style]:-translate-x-full"
      : "data-[starting-style]:translate-x-full data-[ending-style]:translate-x-full";

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      modal={false}
      disablePointerDismissal
    >
      <Dialog.Portal>
        <Dialog.Viewport className="pointer-events-none fixed inset-0 z-50">
          <Dialog.Popup
            ref={popupRef}
            className={`pointer-events-auto fixed top-0 flex h-full flex-col border-(--line) bg-(--bg) shadow-(--shadow-2) pt-14 translate-x-0 transition-transform duration-200 ease-in-out ${widthClass} ${borderClass} ${animClass} ${className}`}
          >
            {children}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

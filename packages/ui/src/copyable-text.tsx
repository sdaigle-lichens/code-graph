import { Tooltip } from "@base-ui/react/tooltip";
import { useState, useRef, useEffect, useCallback } from "react";

interface CopyableTextProps {
  text: string;
  /** Static content, or a render function receiving the current `copied` state so the trigger can show a copied cue. */
  children: React.ReactNode | ((copied: boolean) => React.ReactNode);
  className?: string;
  copiedText?: string;
  previewText?: string;
}

export default function CopyableText({
  text,
  children,
  className = "",
  copiedText = "Copied!",
  previewText = "Click to copy",
}: CopyableTextProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleClick = useCallback(() => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1800);
  }, [text]);

  return (
    <Tooltip.Provider delay={200} closeDelay={0}>
      <Tooltip.Root>
        <Tooltip.Trigger
          render={(props) => (
            <span
              {...props}
              data-copied={copied ? "" : undefined}
              className={`cursor-pointer select-none ${className}`}
            >
              {typeof children === "function" ? children(copied) : children}
            </span>
          )}
          tabIndex={0}
          onClick={handleClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleClick();
            }
          }}
          aria-label={`Copy ${text}`}
        />
        <Tooltip.Portal>
          <Tooltip.Positioner side="bottom" sideOffset={6}>
            <Tooltip.Popup className="rounded-md border border-border-strong bg-(--bg-3) px-2 py-1 text-[11px] font-medium text-(--ink-2) shadow-(--shadow-1) transition-opacity duration-150 data-[instant]:transition-none data-[open]:opacity-100 data-[closed]:opacity-0">
              {copied ? copiedText : previewText}
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

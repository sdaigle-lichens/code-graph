import type { ReactNode } from "react";
import Dialog from "./dialog";

export interface ShortcutSection {
  title: string;
  items: [label: string, keys: string][];
}

interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  titleIcon?: ReactNode;
  sections: ShortcutSection[];
}

export default function ShortcutsDialog({
  open,
  onOpenChange,
  title = "Keyboard shortcuts",
  titleIcon,
  sections,
}: ShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} titleIcon={titleIcon}>
      <div className="flex gap-7 px-5.5 py-4.5">
        {sections.map((s) => (
          <div key={s.title} className="flex-1">
            <div className="text-[11px] font-semibold tracking-[0.6px] text-subtle uppercase mb-2.5">{s.title}</div>
            {s.items.map(([label, keys], i) => (
              <div key={i} className="flex items-center gap-2.5 py-1.5 text-[13px] text-(--ink-2)">
                <span className="flex-1">{label}</span>
                <kbd className="inline-flex items-center px-1.5 py-0.5 rounded bg-(--bg-2) border border-(--line) text-[11px] text-(--ink-2) font-mono">
                  {keys}
                </kbd>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Dialog>
  );
}

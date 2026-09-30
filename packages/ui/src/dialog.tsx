import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import type { ReactNode } from "react";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  titleIcon?: ReactNode;
  widthClass?: string;
  children: ReactNode;
}

export default function Dialog({
  open,
  onOpenChange,
  title,
  titleIcon,
  widthClass = "w-[540px]",
  children,
}: DialogProps) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-[60] bg-black/30 backdrop-blur-[2px] data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity duration-150" />
        <BaseDialog.Popup
          className={`fixed left-1/2 top-1/2 z-[61] -translate-x-1/2 -translate-y-1/2 max-w-[90%] bg-(--bg-elev) rounded-[14px] border border-(--line) overflow-hidden shadow-[0_24px_60px_rgba(0,0,0,.2)] outline-none data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:scale-95 transition-[opacity,transform] duration-200 ease-[cubic-bezier(.2,.7,.3,1)] ${widthClass}`}
        >
          {title && (
            <div className="flex items-center gap-2.5 px-[22px] py-[18px] border-b border-(--line)">
              {titleIcon && (
                <div className="w-7 h-7 rounded-[7px] bg-(--primary-dim) text-(--primary) flex items-center justify-center">
                  {titleIcon}
                </div>
              )}
              <BaseDialog.Title className="text-[15px] font-bold text-(--ink) m-0">{title}</BaseDialog.Title>
              <div className="flex-1" />
              <BaseDialog.Close
                aria-label="Close dialog"
                className="p-1.5 rounded-md text-(--ink-3) flex cursor-pointer focus:outline-none focus:shadow-none hover:bg-(--bg-2)"
              >
                <svg
                  viewBox="0 0 24 24"
                  width={14}
                  height={14}
                  aria-hidden
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </BaseDialog.Close>
            </div>
          )}
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

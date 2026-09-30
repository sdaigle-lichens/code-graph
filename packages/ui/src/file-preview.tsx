import type { ReactNode } from "react";
import SyntaxLine from "./syntax-line";

interface FilePreviewProps {
  label?: string;
  filename: string;
  fileIcon?: ReactNode;
  path?: string;
  lines?: string[];
  children?: ReactNode;
}

export default function FilePreview({
  label = "Template preview",
  filename,
  fileIcon,
  path,
  lines,
  children,
}: FilePreviewProps) {
  return (
    <div className="h-full flex flex-col bg-(--bg-2) gap-3 p-5">
      <div className="flex items-center gap-2">
        <div className="text-[11px] font-semibold tracking-[0.6px] text-(--ink-3) uppercase">{label}</div>
        <div className="flex-1" />
        {path && <div className="font-mono text-[11px] text-(--ink-4)">{path}</div>}
      </div>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-(--bg-elev) rounded-[10px] border border-(--line) shadow-[0_2px_10px_rgba(0,0,0,.03)]">
        <div className="h-[34px] flex items-center gap-1.5 px-2.5 shrink-0 bg-(--bg-2) border-b border-(--line)">
          <div className="flex gap-[5px] mr-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#e5b4a3]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#e9d394]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#a8d59f]" />
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[11px] text-(--ink-2) px-2.5 py-1 mt-1.5 bg-(--bg-elev) border border-(--line) border-b-0 rounded-t-[4px]">
            {fileIcon}
            {filename}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden py-3 font-mono text-xs leading-[1.7]">
          {lines
            ? lines.map((l, i) => (
                <div key={i} className="grid grid-cols-[40px_1fr] pr-3">
                  <span className="text-(--ink-4) opacity-55 text-right pr-3 text-[11px] select-none">{i + 1}</span>
                  <span className="whitespace-pre-wrap wrap-break-word">{l ? <SyntaxLine raw={l} /> : " "}</span>
                </div>
              ))
            : children}
        </div>
      </div>
    </div>
  );
}

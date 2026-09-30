import type { ReactNode } from "react";

const tones = {
  warn: "bg-(--yellow-dim) text-(--yellow)",
  info: "bg-(--primary-dim) text-(--primary)",
  ok: "bg-(--green-dim) text-(--green)",
  bad: "bg-(--red-dim) text-(--red)",
} as const;

export default function Badge({ tone, children }: { tone: keyof typeof tones; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

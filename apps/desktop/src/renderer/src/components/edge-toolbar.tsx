import { edgeStyle } from "../lib/graph-palette";

interface Props {
  counts: { type: string; count: number }[];
  enabled: ReadonlySet<string>;
  onToggle: (type: string) => void;
}

export default function EdgeToolbar({ counts, enabled, onToggle }: Props) {
  return (
    <div role="group" aria-label="Edge types" className="flex flex-wrap items-center gap-2">
      {counts.map(({ type, count }) => {
        const on = enabled.has(type);
        const s = edgeStyle(type);
        return (
          <button
            key={type}
            type="button"
            aria-pressed={on}
            data-edge-toggle={type}
            onClick={() => onToggle(type)}
            className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-xs ${
              on ? "border-(--line-2) bg-(--bg-elev) text-(--ink)" : "border-(--line) bg-transparent text-(--ink-3)"
            }`}
          >
            <svg width="22" height="8" aria-hidden="true">
              <line
                x1="0"
                y1="4"
                x2="22"
                y2="4"
                style={{
                  stroke: s.stroke,
                  strokeWidth: 2,
                  strokeDasharray: s.dash,
                  opacity: on ? 1 : 0.4,
                }}
              />
            </svg>
            <span>{type}</span>
            <span className="font-mono text-(--ink-3)" data-count>
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

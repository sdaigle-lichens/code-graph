import { useRef, useState } from "react";

interface ChipInputProps {
  id?: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}

export default function ChipInput({ id, values, onChange, placeholder }: ChipInputProps) {
  const [draft, setDraft] = useState("");
  const [focus, setFocus] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function add(v: string) {
    const t = v.trim();
    if (!t || values.includes(t)) return;
    onChange([...values, t]);
  }

  function remove(index: number) {
    onChange(values.filter((_, i) => i !== index));
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      add(draft);
      setDraft("");
    } else if (e.key === "Backspace" && !draft && values.length) {
      onChange(values.slice(0, -1));
    }
  }

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      className="flex flex-wrap items-center gap-1.5 py-1.5 pl-2.5 pr-2 min-h-10 rounded-lg bg-(--bg-elev) cursor-text transition-all duration-150"
      style={{
        border: `1.5px solid ${focus ? "var(--primary)" : "var(--line)"}`,
        boxShadow: focus ? "0 0 0 3px var(--primary-dim)" : "none",
      }}
    >
      {values.map((v, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1.5 py-[3px] pl-[9px] pr-1 rounded-md bg-(--bg-elev) border border-(--line) text-xs text-(--ink-2)"
        >
          {v}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              remove(i);
            }}
            aria-label={`Remove ${v}`}
            className="p-0.5 rounded-[3px] flex items-center text-(--ink-3) cursor-pointer focus:outline-none focus:shadow-none"
          >
            <svg
              viewBox="0 0 24 24"
              width={10}
              height={10}
              aria-hidden
              fill="none"
              stroke="currentColor"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        id={id}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onFocus={() => setFocus(true)}
        onBlur={() => {
          setFocus(false);
          add(draft);
          setDraft("");
        }}
        placeholder={values.length ? "" : placeholder}
        className="flex-1 min-w-[120px] h-[26px] bg-transparent border-none outline-none text-[13px] text-(--ink) font-sans placeholder:text-(--ink-4) focus:outline-none focus:shadow-none"
      />
    </div>
  );
}

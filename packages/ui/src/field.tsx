import { useState, type ReactNode, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

interface FieldProps {
  id?: string;
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}

export function Field({ id, label, hint, error, children }: FieldProps) {
  return (
    <div id={id} className="py-4 border-t border-(--line) rounded-md transition-shadow duration-300">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[13px] font-semibold text-(--ink)">{label}</span>
      </div>
      {hint && <div className="text-xs text-(--ink-3) mb-2 leading-relaxed">{hint}</div>}
      {children}
      {error && (
        <div className="text-xs text-(--red) mt-1.5 flex items-center gap-1.5">
          <span className="w-1 h-1 rounded-full bg-(--red) shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
  error?: string | null;
}

export function Input({ value, onChange, mono, error, ...rest }: InputProps) {
  const [focus, setFocus] = useState(false);
  const ringColor = error ? "var(--red)" : focus ? "var(--primary)" : "var(--line)";
  return (
    <div
      className="flex items-center px-3 h-10 rounded-lg bg-(--bg-elev) transition-all duration-150"
      style={{
        border: `1.5px solid ${ringColor}`,
        boxShadow: focus && !error ? "0 0 0 3px var(--primary-dim)" : "none",
      }}
    >
      <input
        {...rest}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => {
          setFocus(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocus(false);
          rest.onBlur?.(e);
        }}
        className={`flex-1 h-full bg-transparent border-none outline-none text-(--ink) placeholder:text-(--ink-4) focus:outline-none focus:shadow-none ${
          mono ? "font-mono text-[13px]" : "font-sans text-sm"
        }`}
      />
    </div>
  );
}

interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> {
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
}

export function Textarea({ value, onChange, error, rows = 4, ...rest }: TextareaProps) {
  const [focus, setFocus] = useState(false);
  const ringColor = error ? "var(--red)" : focus ? "var(--primary)" : "var(--line)";
  return (
    <div
      className="px-3 py-2.5 rounded-lg bg-(--bg-elev) transition-all duration-150"
      style={{
        border: `1.5px solid ${ringColor}`,
        boxShadow: focus && !error ? "0 0 0 3px var(--primary-dim)" : "none",
      }}
    >
      <textarea
        {...rest}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => {
          setFocus(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocus(false);
          rest.onBlur?.(e);
        }}
        className="w-full border-none outline-none bg-transparent resize-y font-sans text-sm text-(--ink) placeholder:text-(--ink-4) leading-relaxed box-border focus:outline-none focus:shadow-none"
      />
    </div>
  );
}

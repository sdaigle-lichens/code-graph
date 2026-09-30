import { Select as BaseSelect } from "@base-ui/react/select";

export interface SelectOption {
  id: string;
  name: string;
  desc?: string;
}

interface SelectProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
}

export default function Select({ id, value, onChange, options, placeholder }: SelectProps) {
  const current = options.find((o) => o.id === value);
  return (
    <BaseSelect.Root value={value} onValueChange={(v) => onChange(v as string)}>
      <BaseSelect.Trigger
        id={id}
        className="w-full h-10 px-3 rounded-lg bg-(--bg-elev) box-border cursor-pointer flex items-center gap-2 transition-all duration-150 focus:outline-none focus:shadow-none border-[1.5px] border-(--line) data-[popup-open]:border-(--primary) data-[popup-open]:shadow-[0_0_0_3px_var(--primary-dim)]"
      >
        <span className={`flex-1 text-left text-sm ${current ? "text-(--ink)" : "text-(--ink-4)"}`}>
          {current ? current.name : placeholder || "Choose…"}
        </span>
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
          <path d="M6 9l6 6 6-6" />
        </svg>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} alignItemWithTrigger={false} className="z-20 outline-none">
          <BaseSelect.Popup className="bg-(--bg-elev) rounded-lg border border-(--line) p-1 max-h-[280px] overflow-y-auto shadow-[0_8px_24px_rgba(0,0,0,.08),0_2px_6px_rgba(0,0,0,.04)] min-w-[var(--anchor-width)] data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity duration-100">
            {options.map((opt) => (
              <BaseSelect.Item
                key={opt.id}
                value={opt.id}
                className="block w-full box-border text-left px-2.5 py-2 rounded-md cursor-pointer focus:outline-none focus:shadow-none data-[highlighted]:bg-(--primary-dim) data-[selected]:bg-(--primary-dim)/50"
              >
                <div className="flex items-center gap-2 text-[13px] font-medium text-(--ink)">
                  <BaseSelect.ItemText>{opt.name}</BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator>
                    <svg
                      viewBox="0 0 24 24"
                      width={12}
                      height={12}
                      aria-hidden
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.4}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M5 12l4 4 10-10" />
                    </svg>
                  </BaseSelect.ItemIndicator>
                </div>
                {opt.desc && <div className="text-[11px] text-(--ink-3) mt-0.5">{opt.desc}</div>}
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}

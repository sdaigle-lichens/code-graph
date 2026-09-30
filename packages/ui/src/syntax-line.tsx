interface SyntaxLineProps {
  raw: string;
}

export default function SyntaxLine({ raw }: SyntaxLineProps) {
  if (raw === "---") return <span className="text-(--ink-4)">{raw}</span>;
  const yaml = raw.match(/^([a-z_]+):\s?(.*)$/);
  if (yaml) {
    const [, k, v] = yaml;
    const isPlaceholder = v.includes("<");
    return (
      <>
        <span className="text-(--primary)">{k}</span>
        <span className="text-(--ink-3)">: </span>
        <span className={isPlaceholder ? "text-(--ink-4) italic" : "text-(--ink-2)"}>{v}</span>
      </>
    );
  }
  const json = raw.match(/^(\s*)"([^"]+)":\s?(.*)$/);
  if (json) {
    const [, indent, k, v] = json;
    const isPlaceholder = v.includes("<");
    return (
      <>
        <span>{indent}</span>
        <span className="text-(--ink-3)">"</span>
        <span className="text-(--primary)">{k}</span>
        <span className="text-(--ink-3)">": </span>
        <span className={isPlaceholder ? "text-(--ink-4) italic" : "text-(--ink-2)"}>{v}</span>
      </>
    );
  }
  if (raw.startsWith("# ")) return <span className="text-(--ink) font-bold">{raw}</span>;
  if (raw.startsWith("## ")) return <span className="text-(--primary) font-semibold">{raw}</span>;
  if (raw.startsWith("<")) return <span className="text-(--ink-4) italic">{raw}</span>;
  return <span className="text-(--ink-2)">{raw}</span>;
}

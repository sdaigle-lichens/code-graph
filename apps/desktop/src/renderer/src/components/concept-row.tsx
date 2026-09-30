import { Link } from "@tanstack/react-router";
import CopyableText from "@repo/ui/copyable-text";
import Button from "@repo/ui/button";
import type { ConceptSummary } from "../../../shared/ipc";
import Badge from "./badge";

export default function ConceptRow({ concept, onDelete }: { concept: ConceptSummary; onDelete: () => void }) {
  const { badges } = concept;
  return (
    <li className="rounded-xl border border-(--line) bg-(--bg-elev) p-4" data-concept={concept.name}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-sm font-bold text-(--ink)">{concept.name}</h3>
        {badges.neverExtracted && <Badge tone="warn">Never extracted</Badge>}
        {badges.neverEnriched && <Badge tone="info">Never enriched</Badge>}
        {badges.noSkillDoc && <Badge tone="info">No skill doc</Badge>}
        {!concept.inConfig && <Badge tone="bad">Not in config</Badge>}
        <div className="flex-1" />
        <span className="text-xs text-(--ink-3)">
          {concept.liveVertices} vertices · {concept.liveEdges} edges
        </span>
        {concept.liveVertices > 0 && (
          <Link
            to="/graph"
            search={{ concept: concept.name }}
            className="text-xs text-(--primary) no-underline hover:underline"
          >
            View graph
          </Link>
        )}
        <Button onClick={onDelete}>Delete</Button>
      </div>
      {concept.globs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {concept.globs.map((g) => (
            <code key={g} className="rounded border border-(--line) px-1.5 py-0.5 text-[11px] text-(--ink-2)">
              {g}
            </code>
          ))}
        </div>
      )}
      {badges.neverExtracted && (
        <div className="mt-3 text-xs text-(--ink-3)">
          No vertices yet. Run this from the config root to populate it:
          <div className="mt-1">
            <CopyableText
              text={concept.extractCommand}
              className="inline-block rounded-md bg-(--bg-2) px-2 py-1 font-mono text-xs text-(--ink)"
            >
              {concept.extractCommand}
            </CopyableText>
          </div>
        </div>
      )}
    </li>
  );
}

import { useEffect, useState } from "react";
import Button from "@repo/ui/button";
import Dialog from "@repo/ui/dialog";
import { toast } from "@repo/ui/toast";
import type { ConceptDeleteResult } from "../../../shared/ipc";
import { api, message, unwrap } from "../lib/api";

type Preview = Extract<ConceptDeleteResult, { stage: "preview" }>;

/** Two-step delete: the first call only computes the dangling-reference report, the second commits. */
export default function DeleteConceptDialog({
  name,
  onClose,
  onDeleted,
}: {
  name: string | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPreview(null);
    setError(null);
    if (!name) return;
    let live = true;
    api.concept.delete({ name, confirm: false }).then((r) => {
      if (!live) return;
      try {
        const d = unwrap(r);
        if (d.stage === "preview") setPreview(d);
      } catch (e) {
        setError(message(e));
      }
    });
    return () => {
      live = false;
    };
  }, [name]);

  async function confirm() {
    if (!name) return;
    setBusy(true);
    try {
      const d = unwrap(await api.concept.delete({ name, confirm: true }));
      if (d.stage === "deleted") {
        toast(`Deleted ${name}: archived ${d.archivedVertices} vertices and ${d.archivedEdges} edges`);
      }
      onDeleted();
    } catch (e) {
      toast(message(e), { variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={name !== null} onOpenChange={(o) => !o && !busy && onClose()} title={`Delete concept ${name ?? ""}`}>
      <div className="p-[22px] text-[13px] text-(--ink-2)">
        {error ? (
          <p className="m-0 text-(--red)">{error}</p>
        ) : !preview ? (
          <p className="m-0">Checking references…</p>
        ) : (
          <>
            <p className="m-0">
              This archives {preview.liveVertices} live vertices, removes the concept from scribe.config.json and
              rebuilds the search index.
            </p>
            <h4 className="mb-1 mt-4 text-[13px] font-semibold text-(--ink)">
              Dangling references ({preview.danglingRefs.length})
            </h4>
            {preview.danglingRefs.length === 0 ? (
              <p className="m-0 text-(--ink-3)">No other concept refers to this one.</p>
            ) : (
              <ul className="m-0 max-h-56 list-disc space-y-1 overflow-auto pl-5">
                {preview.danglingRefs.map((r, i) => (
                  <li key={i}>
                    <span className="font-semibold">{r.fromConcept}</span> ({r.kind === "agent_edge" ? "edge" : "ref"}):{" "}
                    {r.description}
                  </li>
                ))}
              </ul>
            )}
            <p className="mb-0 mt-4 text-xs text-(--ink-3)">{preview.note}</p>
          </>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={confirm} loading={busy} disabled={!preview}>
            Delete concept
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

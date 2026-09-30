import { useState } from "react";
import Button from "@repo/ui/button";
import { Field, Input } from "@repo/ui/field";
import { toast } from "@repo/ui/toast";
import type { ConceptListResult, GraphStatus } from "../../../shared/ipc";
import { api, message, unwrap } from "../lib/api";
import Badge from "./badge";

function isInside(file: string, root: string): boolean {
  const r = root.replace(/[\\/]+$/, "");
  return file === r || file.startsWith(r + "/") || file.startsWith(r + "\\");
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 py-1.5 text-[13px]">
      <div className="w-28 shrink-0 text-(--ink-3)">{label}</div>
      <div className="min-w-0 flex-1 break-all text-(--ink)">{children}</div>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-(--line) px-3 py-2">
      <div className="text-lg font-bold text-(--ink)">{value}</div>
      <div className="text-[11px] text-(--ink-3)">{label}</div>
    </div>
  );
}

function InitOffer({ status, onDone }: { status: GraphStatus; onDone: (s: GraphStatus) => void }) {
  const [project, setProject] = useState(status.defaults.project);
  const [tsconfig, setTsconfig] = useState(status.defaults.tsconfig);
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    try {
      onDone(unwrap(await api.graph.init({ project: project.trim(), tsconfig: tsconfig.trim() })));
      toast("Created scribe.config.json");
    } catch (e) {
      toast(message(e), { variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-(--line) bg-(--bg-2) p-4">
      <div className="text-[13px] font-semibold text-(--ink)">code-graph is not set up in this project</div>
      <p className="m-0 mt-1 text-xs text-(--ink-3)">
        Nothing has been written to this directory. Creating the config writes only scribe.config.json; the graph store
        is created when the pipeline first runs.
      </p>
      <Field label="Project name">
        <Input value={project} onChange={setProject} aria-label="Project name" />
      </Field>
      <Field label="tsconfig path" hint="Relative to the project directory.">
        <Input value={tsconfig} onChange={setTsconfig} mono aria-label="tsconfig path" />
      </Field>
      <Button variant="primary" onClick={accept} loading={busy} disabled={!project.trim() || !tsconfig.trim()}>
        Create scribe config
      </Button>
    </div>
  );
}

export default function StatusCard({
  status,
  concepts,
  onStatus,
}: {
  status: GraphStatus;
  concepts: ConceptListResult | null;
  onStatus: (s: GraphStatus) => void;
}) {
  const { config, configError, store } = status;
  const counts = store.counts;
  return (
    <section className="rounded-xl border border-(--line) bg-(--bg-elev) p-5" aria-label="Project status">
      <Row label="Scribe config">
        {config ? (
          <span>
            <span className="font-mono text-xs">{config.path}</span>
            {!isInside(config.path, status.root) && (
              <span className="mt-1 block text-xs text-(--ink-3)">Using config from a parent directory.</span>
            )}
          </span>
        ) : configError ? (
          <span className="text-(--red)">Invalid config: {configError}</span>
        ) : (
          <Badge tone="warn">None found</Badge>
        )}
      </Row>
      <Row label="Graph store">
        {store.present ? (
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="ok">Present</Badge>
            <span className="font-mono text-xs">{store.path}</span>
          </span>
        ) : (
          <Badge tone="warn">Not present</Badge>
        )}
      </Row>
      {store.present && (
        <Row label="Schema version">
          <span className="flex items-center gap-2">
            {store.schemaVersion ?? "unknown"} (expected {store.expectedSchemaVersion})
            {store.schemaMatches ? <Badge tone="ok">Matches</Badge> : <Badge tone="bad">Mismatch</Badge>}
          </span>
        </Row>
      )}
      {store.error && (
        <Row label="Store error">
          <span className="text-(--red)">{store.error}</span>
        </Row>
      )}
      {counts && (
        <div className="mt-3 grid grid-cols-3 gap-3">
          <Count label="Live vertices" value={counts.vertices} />
          <Count label="Edges" value={counts.edges} />
          <Count label="Docs" value={counts.docs} />
        </div>
      )}
      {counts && concepts && concepts.concepts.length > 0 && (
        <table className="mt-3 w-full text-left text-xs text-(--ink-2)">
          <thead className="text-(--ink-3)">
            <tr>
              <th className="py-1 font-medium">Concept</th>
              <th className="py-1 font-medium">Vertices</th>
              <th className="py-1 font-medium">Edges</th>
            </tr>
          </thead>
          <tbody>
            {concepts.concepts.map((c) => (
              <tr key={c.name} className="border-t border-(--line)">
                <td className="py-1">{c.name}</td>
                <td className="py-1">{c.liveVertices}</td>
                <td className="py-1">{c.liveEdges}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!config && !configError && <InitOffer status={status} onDone={onStatus} />}
    </section>
  );
}

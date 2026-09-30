import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { ConceptListResult, GraphStatus } from "../../../shared/ipc";
import { api, unwrap } from "../lib/api";
import { useAsync } from "../lib/use-async";
import StatusCard from "../components/status-card";
import ConceptRow from "../components/concept-row";
import AddConceptForm from "../components/add-concept-form";
import DeleteConceptDialog from "../components/delete-concept-dialog";

export const Route = createFileRoute("/project")({ component: ProjectPage });

function ProjectPage() {
  const navigate = useNavigate();
  const project = useAsync(async () => unwrap(await api.project.get()), []);
  const root = project.data?.current?.root ?? null;
  const [deleting, setDeleting] = useState<string | null>(null);

  const status = useAsync<GraphStatus | null>(async () => (root ? unwrap(await api.graph.status()) : null), [root]);
  const concepts = useAsync<ConceptListResult | null>(
    async () => (root ? unwrap(await api.concept.list()) : null),
    [root]
  );

  // Project switched elsewhere (or closed): follow the main process, don't show stale data.
  useEffect(() => api.project.onChanged(() => project.reload()), [project.reload]);

  useEffect(() => {
    if (!project.loading && !project.error && !root) void navigate({ to: "/" });
  }, [project.loading, project.error, root, navigate]);

  function refresh() {
    status.reload();
    concepts.reload();
  }

  const list = concepts.data;
  const canManage = list?.configRoot != null;
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <header className="flex items-center gap-3">
        <Link to="/" className="text-xs text-(--ink-3) no-underline hover:text-(--ink)">
          ← Projects
        </Link>
        <h1 className="m-0 text-xl font-bold text-(--ink)">{project.data?.current?.name}</h1>
        <span className="truncate font-mono text-xs text-(--ink-3)">{root}</span>
      </header>

      {(project.error || status.error) && <p className="text-[13px] text-(--red)">{project.error ?? status.error}</p>}
      {status.data && (
        <StatusCard
          status={status.data}
          concepts={list}
          onStatus={(s) => {
            status.set(s);
            concepts.reload();
          }}
        />
      )}

      {canManage && (
        <section aria-label="Concepts" className="space-y-3">
          <h2 className="m-0 text-sm font-semibold text-(--ink-2)">Concepts</h2>
          {!list.storeAvailable && (
            <p className="m-0 text-xs text-(--ink-3)">
              No usable graph store, so counts are zero until the pipeline has run.
            </p>
          )}
          {list.concepts.length === 0 && <p className="m-0 text-[13px] text-(--ink-3)">No concepts yet.</p>}
          <ul className="m-0 list-none space-y-3 p-0">
            {list.concepts.map((c) => (
              <ConceptRow key={c.name} concept={c} onDelete={() => setDeleting(c.name)} />
            ))}
          </ul>
          <h2 className="mb-0 mt-6 text-sm font-semibold text-(--ink-2)">Add a concept</h2>
          <AddConceptForm
            onAdded={(r) => {
              concepts.set(r);
              status.reload();
            }}
          />
        </section>
      )}
      {concepts.error && <p className="text-[13px] text-(--red)">{concepts.error}</p>}

      <DeleteConceptDialog
        name={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          setDeleting(null);
          refresh();
        }}
      />
    </main>
  );
}

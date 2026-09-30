import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import Button from "@repo/ui/button";
import { toast } from "@repo/ui/toast";
import { api, message, unwrap } from "../lib/api";
import { useAsync } from "../lib/use-async";

export const Route = createFileRoute("/")({ component: ProjectPicker });

function ProjectPicker() {
  const navigate = useNavigate();
  const state = useAsync(async () => unwrap(await api.project.get()), []);
  const [busy, setBusy] = useState(false);

  async function pick() {
    setBusy(true);
    try {
      const out = unwrap(await api.project.pick());
      if (!out.cancelled) await navigate({ to: "/project" });
    } catch (e) {
      toast(message(e), { variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function open(root: string) {
    try {
      unwrap(await api.project.open(root));
      await navigate({ to: "/project" });
    } catch (e) {
      toast(message(e), { variant: "error" });
      state.reload();
    }
  }

  async function forget(root: string) {
    try {
      state.set(unwrap(await api.project.forget(root)));
    } catch (e) {
      toast(message(e), { variant: "error" });
    }
  }

  const recent = state.data?.recent ?? [];
  return (
    <main className="mx-auto max-w-2xl p-8">
      <div className="flex items-center gap-3">
        <h1 className="m-0 flex-1 text-xl font-bold text-(--ink)">code-graph</h1>
        <Button variant="primary" onClick={pick} loading={busy}>
          Open project…
        </Button>
      </div>
      <h2 className="mb-2 mt-8 text-sm font-semibold text-(--ink-2)">Recent projects</h2>
      {state.error && <p className="text-[13px] text-(--red)">{state.error}</p>}
      {!state.loading && !state.error && recent.length === 0 && (
        <p className="text-[13px] text-(--ink-3)">No projects yet. Choose a directory to get started.</p>
      )}
      <ul className="m-0 list-none space-y-2 p-0">
        {recent.map((p) => (
          <li key={p.root} className="flex items-center gap-2 rounded-xl border border-(--line) bg-(--bg-elev) p-3">
            <button
              type="button"
              onClick={() => open(p.root)}
              className="min-w-0 flex-1 cursor-pointer bg-transparent p-0 text-left"
            >
              <div className="text-sm font-semibold text-(--ink)">{p.name}</div>
              <div className="truncate font-mono text-xs text-(--ink-3)">{p.root}</div>
            </button>
            <Button onClick={() => forget(p.root)}>Remove</Button>
          </li>
        ))}
      </ul>
    </main>
  );
}

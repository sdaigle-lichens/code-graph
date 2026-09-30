import { useState } from "react";
import Button from "@repo/ui/button";
import ChipInput from "@repo/ui/chip-input";
import { Field, Input } from "@repo/ui/field";
import { toast } from "@repo/ui/toast";
import type { ConceptListResult } from "../../../shared/ipc";
import { api, message, unwrap } from "../lib/api";

export default function AddConceptForm({ onAdded }: { onAdded: (r: ConceptListResult) => void }) {
  const [name, setName] = useState("");
  const [globs, setGlobs] = useState<string[]>([]);
  const [skill, setSkill] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const trimmed = skill.trim();
      onAdded(unwrap(await api.concept.add({ name: name.trim(), globs, ...(trimmed ? { skill: trimmed } : {}) })));
      toast(`Added concept ${name.trim()}`);
      setName("");
      setGlobs([]);
      setSkill("");
    } catch (err) {
      toast(message(err), { variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-(--line) bg-(--bg-elev) px-5 pb-5 pt-1">
      <Field label="Name" hint="Letters, digits, dots, dashes and underscores.">
        <Input value={name} onChange={setName} placeholder="workorder-store" aria-label="Concept name" />
      </Field>
      <Field label="Globs" hint="Press Enter to add each glob.">
        <ChipInput id="concept-globs" values={globs} onChange={setGlobs} placeholder="src/store/**/*.ts" />
      </Field>
      <Field label="Skill document (optional)" hint="Path to a markdown file, relative to the config root.">
        <Input
          value={skill}
          onChange={setSkill}
          mono
          placeholder="skills/my-concept/SKILL.md"
          aria-label="Skill path"
        />
      </Field>
      <Button type="submit" variant="primary" loading={busy} disabled={!name.trim() || globs.length === 0}>
        Add concept
      </Button>
    </form>
  );
}

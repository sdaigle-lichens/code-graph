# Report r024: 026-name-the-fix-when-the-store-can-t-open-and-make-uninstall-list-what-install-added.md

- Task: 026-name-the-fix-when-the-store-can-t-open-and-make-uninstall-list-what-install-added.md
- Written: 2026-10-21T15:00:25.930Z
- From session: maestro-fef84d2f

Outcome: task 026 done, uncommitted in the main checkout. Version 0.3.19 in all three files, bundle regenerated.
- node:sqlite missing: store commands exit 8 with one line naming Node >=22.5 and `node --version`. One commander preAction hook in cli.ts, via the new sqlite-guard.ts. extract, catalog, skills and deps are deliberately outside the guard because they never load node:sqlite (the task named extract). Documented in docs/usage.md, the retrieval skill table and docs/installation.md.
- deps status: present/absent/unreadable/not-visible. Sandboxed ENOENT is absent when the cache root or its parent lists; not-visible when neither does; EACCES/EPERM stays unreadable. Tests cover all three sandboxed cases plus non-sandboxed absent.
- Uninstall skill: one consent per item, default no, for the skills block, .gitignore line, allowRead entry, deps cache and gap files; lists what it keeps.
- Verification: pnpm --filter code-graph test 435/435, pnpm check green, just eval 7/7. The user confirmed full pnpm test and claude plugin validate pass outside the sandbox; neither ran in the sandbox (turbo strips TMPDIR so tsx fails; no claude binary).
- Review found three doc wording defects; scribe fixed them.
Post-mortem: clean run, none.
Suggested ticket changes: none.

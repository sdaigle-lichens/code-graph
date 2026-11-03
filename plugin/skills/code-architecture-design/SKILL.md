---
name: code-architecture-design
description: "Architecture design pass, run before implementation: designs a deep module — a lot of behaviour behind a small interface, at a deliberately placed seam. Use when use-code-architecture-design-check says to run it, when a task adds or reshapes a concept, when several architectures are plausible, or when the user asks to design a module, an interface or a seam."
allowed-tools: Read, Grep, Glob, Bash
---

# Code Architecture Design

Design the shape of the code **before** any of it is written: what the module is, what its interface costs a caller, and where its seam sits. The output is a Design Brief the implementer follows.

The aim is leverage for callers, locality for maintainers, and testability for everyone. Use the vocabulary in §Glossary exactly — the terms are the point, and substituting "component", "service", "API" or "boundary" loses the distinction each one is carrying.

## 1. Load the project's concepts

Run the `explore-concept-skills` skill to find and load the concept skills this task touches, before
designing anything. Carry every concept it names into the Design Brief's **Concepts touched** field —
name, in the brief, every concept the new module sits next to.

**When the code graph exists** (`scribe.config.json` with a built store), also ground the callers
inventory of §2 in it instead of guessing:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs" query cross <concept-a> <concept-b>
node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs" query impact <symbol> --direction in
```

`query cross` shows how two concepts the module will sit between already touch; `query impact` lists
the callers and dependents of the symbol being reshaped — that is "who calls it" and "what each
caller has to know today", read from the code. Exit 6, exit 5 or a missing store means no graph:
read the concept skills and sibling files instead. Nothing here needs a tsconfig.

## 2. Frame the module

Write down, in a few lines each:

- **What the module is for** — the one job it does, in the project's own domain language.
- **Who calls it**, and what each caller has to know today to do this job by hand. That inventory is the complexity you are trying to move behind the interface.
- **What varies** across those callers, and what is the same everywhere. Only what varies belongs in parameters; the rest belongs inside.
- **What it must not know about** — the callers, transports or storage it stays ignorant of.

**Trap:** framing straight from a proposed file layout. Layout is an output of this pass, not an input; starting there produces one module per file and a pass-through interface at every seam.

## 3. Design the interface

Design the whole interface, not just the types: invariants, ordering constraints, error modes, required configuration, and performance characteristics are all part of it.

```
   Deep (aim for this)              Shallow (avoid)
┌─────────────────────┐   ┌─────────────────────────────────┐
│   Small interface   │   │        Large interface          │
├─────────────────────┤   ├─────────────────────────────────┤
│                     │   │  Thin implementation            │
│ Deep implementation │   └─────────────────────────────────┘
│                     │
└─────────────────────┘
```

For each entry point, ask:

- Can I remove a method — is this one a caller-side convenience that belongs in the caller?
- Can I simplify the parameters — is this flag really two call sites wanting two different things?
- Can I hide more inside — is the caller being made to sequence, retry, validate or clean up?
- What must a caller know that the signature does not say? Write it down; it is part of the interface whether or not you admit it.

Then apply the **deletion test**: imagine the module deleted. If complexity vanishes, it was a pass-through and should not exist. If the same complexity reappears in N callers, it is earning its keep.

## 4. Place the seam and classify the dependencies

*Where* the seam goes is a separate decision from *what* sits behind it — make it deliberately.

Classify each dependency; the category decides how the module is tested across the seam.

| Dependency | Examples | Seam and test strategy |
| --- | --- | --- |
| **In-process** | Pure computation, in-memory state | No seam needed. Merge and test directly through the new interface. |
| **Local-substitutable** | Postgres w/ PGLite, in-memory fs | Seam stays **internal**; the stand-in runs in the test suite. No port at the external interface. |
| **Remote but owned** | Your own service over HTTP/gRPC/queue | Define a **port** at the seam: transport injected as an adapter — HTTP in production, in-memory in tests. |
| **True external** | Stripe, Twilio, anything you don't control | Injected port, mock adapter in tests. |

Two rules that stop seams from multiplying:

- **One adapter means a hypothetical seam. Two adapters means a real one.** Don't introduce a port unless at least two adapters are justified — typically production plus test. A single-adapter seam is just indirection.
- **Internal seams are not part of the interface.** A deep module may be composed internally of small, swappable parts used by its own tests. Don't expose them through the interface because the tests reach them.

## 5. Design it twice

Your first interface is unlikely to be the best. Sketch **at least two radically different** ones — not two spellings of the same idea. Useful axes to pull apart:

- *Minimal*: 1–3 entry points, maximum leverage each.
- *Flexible*: more surface, supports many callers and extension.
- *Common-case first*: the default call is trivial, everything else is opt-in.
- *Ports & adapters*: organised around the cross-seam dependency.

Compare them on **depth**, **locality** (where a future change concentrates), and **seam placement**. Then be opinionated: recommend one, or propose a hybrid, and say why. Present the alternatives to the user before committing — a rejected design recorded in the brief is what stops the next session re-litigating it.

## 6. Design for testability

The **interface is the test surface**. Callers and tests cross the same seam; if you want to test
*past* the interface, the module is the wrong shape.

1. **Accept dependencies, don't create them.**

   ```typescript
   function processOrder(order, paymentGateway) {} // testable
   function processOrder(order) { const gw = new StripeGateway(); } // not
   ```

2. **Return results, don't produce side effects.**

   ```typescript
   function calculateDiscount(cart): Discount {} // testable
   function applyDiscount(cart): void { cart.total -= discount; } // not
   ```

3. **Replace, don't layer.** Tests at the deepened interface make the old unit tests on the shallow
   pieces waste — plan their deletion in the brief. Assert observable outcomes through the
   interface, never internal state, so the tests survive an internal refactor.

## Mandatory output — the Design Brief

End with this, and nothing else after it. It is what the implementer reads; keep it short enough to
be read in full.

```markdown
**Module:** <name and the one job it does>
**Concepts touched:** <concept skills / existing patterns it sits next to, or "none — new concept">
**Interface:** <entry points with params and return types, then the invariants, ordering
constraints, error modes and configuration a caller must know>
**Hidden behind it:** <the complexity callers no longer carry>
**Seam:** <where it sits, dependency category, and the adapters — or "no seam: in-process">
**Alternatives rejected:** <the other designs, one line each, and why this one won>
**Tests:** <what is asserted through the interface; which existing tests get deleted>
**Open questions:** <anything the user must decide before implementation, or "none">
```

## What this skill does not do

- **It does not implement.** No edits, no files created, no scaffolding — the brief is the artifact.
- **It does not decide whether a design pass is needed.** That is `use-code-architecture-design-check`;
  by the time you are here, the answer was yes.
- **It does not do visual or UI design.** That is `/design` (the Claude Design canvas) — a different
  skill with a confusingly similar name.

## Glossary

Use these terms exactly.

- **Module** — anything with an interface and an implementation. Deliberately scale-agnostic: a function, class, package, or tier-spanning slice. *Avoid*: unit, component, service.
- **Interface** — everything a caller must know to use the module correctly. *Avoid*: API, signature, the TypeScript `interface` keyword, a class's public methods — all too narrow, naming only the type-level surface.
- **Implementation** — what is inside the module. Distinct from **adapter**: a thing can be a small adapter with a large implementation (a Postgres repo) or a large adapter with a small one (an in-memory fake). Say "adapter" when the seam is the topic, "implementation" otherwise.
- **Depth** — leverage at the interface: how much behaviour a caller or test can exercise per unit of interface it has to learn. **Deep** = much behaviour behind a small interface; **shallow** = interface nearly as complex as the implementation.
- **Seam** *(Michael Feathers)* — a place where behaviour can be altered without editing in that place; the location at which a module's interface lives. *Avoid*: boundary — overloaded with DDD's bounded context.
- **Adapter** — a concrete thing satisfying an interface at a seam. Describes *role* (which slot it fills), not substance (what is inside it).
- **Leverage** — what callers get from depth: one implementation pays back across N call sites and M tests.
- **Locality** — what maintainers get from depth: change, bugs, knowledge and verification concentrate in one place. Fix once, fixed everywhere.

**Framing deliberately rejected**, so it doesn't creep back in: *depth as the ratio of implementation
lines to interface lines* (Ousterhout) — it rewards padding the implementation. Depth here is leverage.

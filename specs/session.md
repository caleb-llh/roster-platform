# Session — the command surface

The **Session layer** is the "time" layer that sits *above* a pure-CRUD provider
([`useSession.js`](../src/session/useSession.js)). It owns two concerns:

1. The **draft/commit + undo/redo** overlay. That model — its separation of
   commit from history, the "commit does not end history" invariant, and how the
   draft resets on a new committed document — is specified in
   [data-layer.md](data-layer.md#draftcommit-is-separate-from-undoredo-history).
   This file does **not** restate it.
2. The **command surface** — the named domain commands the UI (and, eventually,
   an inbound bot) drives. That is what this file owns.

See [architecture.md](architecture.md) for the Session-above-Provider layering
and [providerContract.js](../src/data/providerContract.js) for the machine-checked
composed key surface (`SESSION_KEYS`).

## Commands are pure; the hook wires them

Every domain mutation is expressed **once**, as a pure function in
[`session/commands.js`](../src/session/commands.js):

```
(state, args) => {
  ok,          // boolean — false ONLY on a hard reject (swap)
  reason,      // string | null — populated on a hard reject
  nextEvents,  // Event[] | null — the events to stage (null on reject / no-op)
  verdict,     // { warnings: string[] } — soft gate; surfaced, does NOT block
  logEntry,    // audit line(s) | null
  ...extra     // e.g. swap's `preview`, clear's `count`
}
```

- `state` is the derived roster state (from [`toState`](../src/state/derivedState.js))
  over the **effective** document (committed + uncommitted draft overlaid), plus
  the provider's `externalAssignments`. It is recomputed per call so a command
  always sees the latest draft.
- The commands own **only** the pure mutation (`nextEvents`) and the rule
  **verdict**. They contain no React, no persistence, and no view prose beyond
  the intrinsic audit line — so they are unit-testable without a renderer
  ([`commands.test.js`](../src/session/commands.test.js)).

[`useSession`](../src/session/useSession.js) wires each command via `runCommand(fn)`:
it checks edit permission, runs the pure function against the current
`commandState()`, applies `nextEvents` to the draft, and returns the
verdict/logEntry/preview to the caller. **Why pure command + thin wrapper:** it
puts the one gate on a *named* action, so a UI click and an inbound bot command
are true peers through one surface — the reason C ("per-action commands") was
pulled into the overhaul rather than left as a generic `stageEvents` escape hatch.

The current commands are `assign`, `addSlot`, `removeSlot`, `swap`,
`clearGenerated`, and `bulkClear`. `stageEvents` remains the **generic** apply
used by the generator (which produces a whole events array staged wholesale) and
by the confirmation handlers below; `stageDocument` stages a whole-document edit
from the YAML editor.

## Gate policy — warn-still-apply, except swap

This is the one deliberate **behaviour change** of the overhaul (step 11). Before
it, the domain mutations lived in `App.jsx` handlers that funnelled through the
generic `stageEvents`, and **only `swap` carried an Evaluation gate**; the other
edits were silent.

- **Warn-still-apply** for the actions that had no gate before (`assign`,
  `addSlot`, `removeSlot`, `clearGenerated`, `bulkClear`): the command **always**
  produces `nextEvents`, and attaches any rule violations on the **affected
  events** as `verdict.warnings`. The edit still applies; the UI surfaces the
  warnings as a notice. **Why not block:** a coordinator may knowingly place an
  unavailable member — that intentional manual-override freedom predates this
  step and must be preserved. Making the verdict *visible* is the improvement;
  taking away the override is not. This is a real behaviour change: those edits
  now emit a warning where before they were silent.
- **`swap` keeps its pre-existing HARD reject** ([`explainSwap`](../src/evaluation/swapPolicy.js)):
  an infeasible swap is blocked (`ok: false`, `reason`), exactly as before — not
  downgraded to a warning, because users already rely on that block.

**The verdict reuses the one validation authority.** `verdictFor` runs
[`validateEventAssignments`](../src/evaluation/assignmentValidator.js) — the same
validator the events panel reads — over `nextEvents` and collects the
errors+warnings for the **affected dates only** (a single manual edit must not
dump the whole roster's pre-existing issues into one toast). Deriving a command's
soft verdict from a separate rule copy would let the command's warning drift from
the panel's; it must not.

## Preview mode — compute without applying

Loss-ful or destructive actions (`swap`, `removeSlot`, `clearGenerated`,
`bulkClear`) are staged behind a **confirmation dialog** in the UI. To support
that without polluting the undo/redo stacks, `runCommand(fn)(args, { preview: true })`
computes the **same result without applying it**. The UI reads the result
(warnings, `count`, swap `preview` card) to render the confirmation, then applies
on confirm via `stageEvents(result.nextEvents)` and writes the audit line.

**Why not apply-then-undo:** an earlier design applied the edit and immediately
called `undo()` for staged actions. That was hacky and polluted the redo stack.
`preview` keeps "compute + verdict" in the command and "confirm UX" in the UI
with no history side effect.

## Separation of concerns

- **Commands** own the pure mutation + rule verdict.
- **`useSession`** owns permission-gating, applying to the draft, and the
  draft/commit/undo overlay (see [data-layer.md](data-layer.md)).
- **The UI** owns confirmation-dialog staging, toast wording, and any richer log
  prose layered on top of the command's intrinsic `logEntry`.

Do not conflate these: a command must not reach into React or persistence, and
the UI must not re-derive rules or re-implement a mutation a command already owns.

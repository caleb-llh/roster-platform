# Session — the command surface

The **Session layer** is the "time" layer that sits *above* a pure-CRUD provider
([`useSession.js`](../src/session/useSession.js)). It owns three concerns:

1. The **draft/commit + undo/redo** overlay. That model — its separation of
   commit from history, the "commit does not end history" invariant, and how the
   draft resets on a new committed document — is specified in
   [data-layer.md](data-layer.md#draftcommit-is-separate-from-undoredo-history).
   This file does **not** restate it.
2. The **derived pipeline**. Session is the single producer of the derived
   stages: it reads the provider's committed `document` and overlays the draft to
   build the **effective document**, casts it with `toState` to a **State**, and
   combines in `externalAssignments` to a **State with external** — exposed as one
   memoized `effectiveStateWithExternal` value (plus `committedEvents` for
   diffing). Every
   consumer (UI render, commands, generator) reads that one value. The "one
   producer, many consumers" invariant, the stage lifetimes, and the full
   walkthroughs are owned by
   [data-layer.md](data-layer.md#data-flow-one-producer-many-consumers); this file
   does **not** restate them.
3. The **command surface** — the named domain commands the UI (and, eventually,
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
  ...extra     // e.g. swap's `previewCard`, clear's `count`
}
```

- `state` (the command's input parameter) is the derived roster `State`
  (from [`toState`](../src/state/derivedState.js)) over the **effective**
  document (committed + uncommitted draft overlaid), plus the provider's
  `externalAssignments` — i.e. a `State with external` (see
  [glossary.md](glossary.md)). Session derives this once as a memoized value
  (`effectiveStateWithExternal`) and the command reads that same value — so a
  command always judges against exactly what the UI renders. See
  [data-layer.md](data-layer.md#data-flow-one-producer-many-consumers).
- The commands own **only** the pure mutation (`nextEvents`) and the rule
  **verdict**. They contain no React, no persistence, and no view prose beyond
  the intrinsic audit line — so they are unit-testable without a renderer
  ([`commands.test.js`](../src/session/commands.test.js)).

[`useSession`](../src/session/useSession.js) wires each command via `runCommand(fn)`:
it checks edit permission, runs the pure function against the current
`effectiveStateWithExternal` value, applies `nextEvents` to the draft, and returns the
verdict/logEntry/preview to the caller. **Why pure command + thin wrapper:** it
puts the one gate on a *named* action, so a UI click and an inbound bot command
are true peers through one surface — which is why per-action commands exist
rather than a generic `stageEvents` escape hatch.

The current commands are `assign`, `addSlot`, `removeSlot`, `swap`,
`clearGenerated`, and `bulkClear` (the last delegates to the `buildBulkClear`
helper in [`session/bulkClear.js`](../src/session/bulkClear.js); its shared
`slotKey` primitive lives in `lib/slotKey.js` since the UI's diff/selection use
it too). `stageEvents` remains the **generic** apply
used by the generator (which produces a whole events array staged wholesale) and
by the confirmation handlers below; `stageDocument` stages a whole-document edit
from the YAML editor.

## Gate policy — warn-still-apply, except swap

The gate policy is **asymmetric by design**: most edits warn-still-apply, and
only `swap` hard-rejects.

- **Warn-still-apply** for `assign`, `addSlot`, `removeSlot`, `clearGenerated`,
  and `bulkClear`: the command **always**
  produces `nextEvents`, and attaches any rule violations on the **affected
  events** as `verdict.warnings`. The edit still applies; the UI surfaces the
  warnings as a notice. **Why not block:** a coordinator may knowingly place an
  unavailable member — that intentional manual-override freedom must be
  preserved. The value is that the verdict is *visible* as a warning, not that
  the override is taken away.
- **`swap` is a HARD reject** ([`explainSwap`](../src/evaluation/swapPolicy.js)):
  an infeasible swap is blocked (`ok: false`, `reason`) — not downgraded to a
  warning, because users rely on that block to catch impossible swaps.

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
(warnings, `count`, swap `previewCard`) to render the confirmation, then applies
on confirm via `stageEvents(result.nextEvents)` and writes the audit line.

**Why not apply-then-undo:** an earlier design applied the edit and immediately
called `undo()` for staged actions. That was hacky and polluted the redo stack.
The `{ preview }` call-mode flag keeps "compute + verdict" in the command and
"confirm UX" in the UI with no history side effect. (The swap result *card* is
named `previewCard`, not `preview`, so the loss-ful action's before/after payload
does not collide with the `{ preview }` input flag on the same command.)

## Separation of concerns

- **Commands** own the pure mutation + rule verdict.
- **`useSession`** owns permission-gating, applying to the draft, and the
  draft/commit/undo overlay (see [data-layer.md](data-layer.md)).
- **The UI** owns confirmation-dialog staging, toast wording, and any richer log
  prose layered on top of the command's intrinsic `logEntry`.

Do not conflate these: a command must not reach into React or persistence, and
the UI must not re-derive rules or re-implement a mutation a command already owns.

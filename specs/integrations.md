# Integrations — read vs. write

This spec owns the **one** rule that keeps integrations from becoming a back
door into the domain core: *"Integrations" is two different things, and they
must not be lumped together.* An integration is either a **read** consumer of a
committed roster or a **write** actor issuing domain commands — and each kind has
a different, non-negotiable path.

Integration code lives in [`../src/integrations/`](../src/integrations/).

## The two kinds

### Read (outbound) integrations — periphery

A read integration **consumes a committed roster and does nothing to the live
core**: a reminder cron that reads the schedule and messages people, a calendar
*export*, a "who's on duty Tuesday?" bot query. They read a **committed
read-model** through the provider; they never reach into the working roster,
the rules, or the evaluation seam.

Because they only read, they sit at the **periphery**. They cannot violate a
constraint — there is nothing to validate — so they are outside the Rules ⋈
State → Evaluation core entirely.

### Write (inbound) integrations — actors on the command surface

A write integration **issues domain mutations**: a bot command "swap me out
Tuesday", "regenerate next month". These are **actors**, exactly like a UI
click, and they **must go through the [Session command surface](session.md)** so
the same Evaluation gate applies to them. They are **peers of the UI**, not a
privileged path into the core.

This is the load-bearing invariant: **a write integration must not reach into
internals.** It calls the same per-action commands the UI calls
(`assign`/`swap`/`clearGenerated`/…), goes through the same warn-still-apply /
swap-hard-reject gate, and lands in the same draft/commit model. A bot and a
button are true peers through one gate.

### Design Decision — read/write is *who touches what*, not HTTP

The split is about **what an integration touches** (read a committed document
vs. issue a command), not about HTTP verbs or transport. Do not build a REST-ish
"inbound/outbound" abstraction around it. The rule is a routing constraint —
reads consume the read-model, writes call the command surface — and that is all
it needs to be.

Keeping the split explicit *strengthens* generation.md's **"one authority, many
consumers"**: the consumers of the shared rules/evaluation are no longer just
the generator/validator/UI — they now include write integrations. Same rules,
more callers.

## What exists today

Today the only integration is Telegram, and it is **read-only**:
[`telegram.js`](../src/integrations/telegram.js) `initTelegram()` mirrors
Telegram's theme colours and viewport/safe-area insets into CSS variables when
the app runs inside the Telegram in-app webview, and is a no-op in a normal
browser. It reads host chrome and writes only CSS variables — it never touches
the roster, so it has no write path to gate.

The **write path is foreshadowed, not built**: a Telegram (or other) bot that
issues `swap`/`regenerate` commands would enter through the Session command
surface as an actor peer to the UI, per the invariant above. There is no such
actor today.

## Boundaries — what this spec does *not* own

- **The read-model bright line** (stats/views recomputed live from current
  state, never snapshotted; the read-model is not a rules registry) is owned by
  [data-layer.md](data-layer.md). A read integration consumes a *committed*
  document via the provider; that is a different fact from how live views are
  derived, and the two must not be conflated here.
- **The command surface itself** (the per-action commands, the gate policy, the
  draft/commit model a write actor lands in) is owned by [session.md](session.md).
  This spec only asserts that write integrations *go through* it.

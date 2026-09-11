# Contributing

Onboarding for developers working on Roster Builder. This file covers **how to
run, build, test, and extend** the app. It deliberately does **not** repeat:

- **Why** the system behaves the way it does → that's the binding spec in
  [`specs/`](specs/).
- **The rule that every change must feed back into the spec** → that's
  [`AGENTS.md`](AGENTS.md).
- **The product pitch** → that's the [`README.md`](README.md).

Read those three first; this file is the practical "how do I work here" layer.

## Prerequisites

- Node.js 18+ and npm.
- For production-mode work only: the [Supabase CLI](https://supabase.com/docs/guides/cli)
  and Docker (to run the local stack).

## Setup

```bash
npm install
```

No environment variables are needed to run the local playground — the app boots
straight into the in-memory YAML editor.

## Everyday commands

```bash
npm run dev            # dev server → http://localhost:5173 (no base path)
npm test               # run tests in watch mode (Vitest)
npx vitest run         # run the whole suite once (CI-style)
npm run test:coverage  # coverage report
npm run test:ui        # Vitest UI
npm run build          # production build (applies the /roster-builder/ base path)
npm run preview        # serve the production build → http://localhost:4173/roster-builder/
```

> The `/roster-builder/` base path applies to production builds only; `npm run
> dev` runs at the root. If a link/asset works in dev but 404s on the deployed
> site, it's almost always a base-path issue — see
> [specs/architecture.md](specs/architecture.md#off-repo-context-deployment-github-pages).

## Deploying

Deployment is **manual** — there is no CI workflow.

```bash
npm run deploy         # runs the build (predeploy), then publishes dist/ to the
                       # gh-pages branch via the gh-pages package
```

The live site is https://caleb-llh.github.io/roster-builder/.

## Working in production mode (Supabase)

Most work happens in the local playground. You only need Supabase when touching
auth, RBAC, persistence, or the migrations. To enable production mode locally,
copy `.env.example` → `.env.local` and set both `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` (the app flips to production when both are present).

```bash
npm run db:start       # start the local Supabase stack (Docker)
npm run db:reset       # reset the local db and re-apply migrations
npm run db:push        # push migrations to the linked hosted project
npm run db:stop        # stop the local stack
```

The data model, RLS, RPCs, OAuth, and env-var contract are documented in
[specs/architecture.md](specs/architecture.md). Don't re-derive them from the
SQL — the spec explains the *why* (e.g. why the roster is one JSONB document and
why membership checks go through `SECURITY DEFINER` helpers).

## Codebase orientation

See the module map in
[specs/architecture.md](specs/architecture.md#module-map) for what lives in each
directory. The short version:

- `src/components/` — React UI.
- `src/data/` — the dual-mode data layer (mode detection, provider contract, the
  two providers, draft/undo/redo transitions).
- `src/hooks/` — `useAuth` and the `useRosterData` dispatcher.
- `src/schema/` — `rosterSchema.js`, the single source of truth for field/config
  key names.
- `src/utils/` — framework-agnostic business logic (validators, diffing, stats,
  constraints, exports, colours, understudy). Heavily unit-tested.
- `src/generation/` — the generation engine, with its own
  [`README.md`](src/generation/README.md) for scoring weights.

## Schema-first: use the constants

`src/schema/rosterSchema.js` is the single source of truth for YAML field names
and configuration keys. Never hard-code these strings — import them.

```js
import { YAML_FIELDS, CONSTRAINT_KEYS, isConstraintEnabled } from './schema/rosterSchema'

const members = data[YAML_FIELDS.MEMBERS]
const period  = data[YAML_FIELDS.ROSTER_PERIOD]   // maps to data.roster

if (isConstraintEnabled(rosterConstraints, CONSTRAINT_KEYS.ENFORCE_MEMBER_ROLES)) {
  // ...
}
```

Standard property access for nested fields (`member.name`, `event.date`) is
fine. **Test data must use these constants too**, so a rename can't silently rot
the tests.

Roster-level **constraints** (hard rules) and **preferences** (soft goals) are
*policy, not data*: their defaults live in `src/config/rosterDefaults.js` and are
merged under any values a document provides. A document only specifies the keys
it overrides. Roles, by contrast, *are* data and belong to a roster document —
they have no default.

### The canonical example document

[`public/sample.yaml`](public/sample.yaml) is the always-valid reference for the
input schema: it must parse and pass `runAllValidators` with zero errors and
exercise every supported field. **Keep it in sync when the schema changes** — a
stale sample is a spec regression (see
[specs/data-layer.md](specs/data-layer.md#sampleyaml-is-the-canonical-valid-schema-example)).
It's the fastest way to learn the input format.

## Recipe: adding a constraint or preference

1. **Schema** — add the key to `CONSTRAINT_KEYS` / `PREFERENCE_KEYS` (with
   metadata) in `rosterSchema.js`.
2. **Default** — set its default in `src/config/rosterDefaults.js`.
3. **Logic** — implement it in `evaluation/eligibilityChecker.js` (a *hard* constraint) or
   `generation/scoringEngine.js` (a *soft* preference). If it's a soft goal, it must **also**
   be a term in the whole-roster objective `evaluateState` (`index.js`) or Phase 2
   local search will undo it — see
   [specs/generation.md](specs/generation.md).
4. **Validation** — add a check in `evaluation/assignmentValidator.js` if manual edits could
   violate it.
5. **Tests** — cover it, using the schema constants.
6. **Docs & sample** — update `public/sample.yaml` and, if the change makes,
   reverses, or clarifies a design decision, record it in the relevant
   [`specs/`](specs/) file (per [`AGENTS.md`](AGENTS.md)).

## Testing

- Vitest + jsdom. Test files live next to the code they cover and span
  validators, generation, constraints, derived state, stats, and a design-system
  lint guard.
- Run a single file: `npm test <filename>`.
- **There is no ESLint.** Some invariants are instead enforced by tests — e.g.
  `src/utils/designSystem.lint.test.js` fails the suite if UI code inlines a
  glass-token string instead of importing it, or uses a banned hue (see
  [specs/design-system.md](specs/design-system.md)). Treat these as guardrails,
  not noise.

## The AI-assisted workflow

This repo is developed with AI coding agents, and the workflow is designed around
that. As a contributor (human or agent) the key thing to internalise:

- **The spec is the shared memory.** Hard-won knowledge — a root cause, why a
  naive approach failed, why a weight has the value it does — lives in
  [`specs/`](specs/), not in commit messages or someone's head. Before changing
  generation, eligibility, scoring, the data structure, the draft/commit model,
  or the understudy feature, **re-read the relevant spec file first.**
- **Every change closes the loop.** Code → tests → spec → verify, *within the same
  change*. The authoritative definition of this loop (and when to add a design
  decision) is in [`AGENTS.md`](AGENTS.md) — follow it; this file won't restate
  it.
- **Verify before you're done:** `npx vitest run` (all pass) and `npm run build`
  (succeeds).
- **Commits** are made only when a human explicitly asks. Don't commit secrets or
  the gitignored `local/` inputs.

If you're an AI agent picking up work here: `AGENTS.md` is your working
agreement, `specs/` is your source of truth for *why*, and this file is your
source of truth for *how to run things*.

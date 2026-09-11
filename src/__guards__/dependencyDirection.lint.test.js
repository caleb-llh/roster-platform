/**
 * Dependency-direction guardrail (dependency-free lint via Vitest).
 *
 * This is step 10 of the architecture overhaul: the CI gate that makes the
 * layer graph's debt un-reintroducible (see architecture-overhaul.plan.md, and
 * the layer model in architecture.md). The repo has no ESLint / dependency-
 * cruiser, so — like the design-system guard (`design/designSystem.lint.test.js`,
 * its precedent) — this test *is* the guardrail: it scans every source file's
 * cross-layer relative imports and fails if an arrow points somewhere the layer
 * model forbids.
 *
 * The rule is **default-deny**: each top-level `src/` folder is a layer, and a
 * layer may only import from the layers listed in ALLOWED below. A new
 * cross-layer arrow that isn't whitelisted fails the test, forcing an explicit
 * decision (add the arrow here + justify it in the plan, or don't draw it).
 *
 * Invariants this locks in (from the layer model):
 *   - Schema is the leaf: it imports nothing.
 *   - `rules/` is the domain heart but NOT a dependency sink — it imports only
 *     Schema (never evaluation/state/generation). Arrows point *into* rules.
 *   - The core (schema/rules/evaluation/state/generation) never imports the
 *     Session or Data layers ("time"/persistence sit *above* the timeless core).
 *   - Read-model views may read the core but nothing imports *them* except the UI.
 *   - `lib/` and `design/` are domain-free leaves.
 *
 * `App.jsx` / `main.jsx` are the composition root (they may import anything) and
 * are intentionally out of scope. Test files are skipped — they legitimately
 * reach across layers to exercise integrations (e.g. `utils/crossTeam.test.js`).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const srcDir = join(here, '..')

/**
 * Allowed outbound arrows, keyed by the *source* layer (top-level `src/`
 * folder). A layer absent from a value list may not be imported from that key.
 * A layer may always import from itself (sibling files) — that is not a
 * cross-layer arrow and is never checked.
 *
 * Ordering note: this mirrors the healthy graph verified in the overhaul
 * (acyclic; `schema` imports nothing; `rules` imports only `schema`).
 */
const ALLOWED = {
  // Core (timeless)
  schema: [], // leaf — imports nothing cross-layer
  rules: ['schema'], // domain heart, not a sink: Schema only
  evaluation: ['rules', 'schema'],
  state: ['schema', 'config', 'design', 'lib', 'rules'], // adapter + tracker reuses a rules counting primitive
  generation: ['state', 'evaluation', 'rules', 'schema'],

  // Periphery / above-core
  readmodel: ['state', 'evaluation', 'rules', 'schema', 'design'], // live views read the core; chart views use design tokens
  session: ['state', 'evaluation', 'utils'], // the "time" layer above the provider
  data: ['state'], // pure-CRUD providers use the adapter (documentValidation/tenantResolver)
  hooks: ['data', 'session'], // dual-mode dispatcher composes them
  components: ['readmodel', 'generation', 'rules', 'schema', 'design', 'lib', 'utils'],

  // Domain-free leaves / grab-bag being dissolved
  lib: [],
  design: [],
  config: ['schema'],
  utils: [], // bulkClear is a leaf domain helper
  integrations: [],
}

/** The composition root — may import anything; not treated as a layer. */
const ROOT_FILES = new Set(['App.jsx', 'main.jsx', 'index.css'])

/** Recursively collect the non-test source files we lint. */
function collectSourceFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) {
      out.push(...collectSourceFiles(abs))
      continue
    }
    if (!/\.(jsx|js)$/.test(name)) continue
    if (/\.test\.jsx?$/.test(name)) continue // tests reach across layers on purpose
    if (/setup\.js$/.test(name)) continue
    out.push(abs)
  }
  return out
}

/** The layer (top-level src/ folder) a file belongs to, or null for the root. */
function layerOf(absPath) {
  const rel = relative(srcDir, absPath).split(sep)
  if (rel.length === 1) return null // a file directly in src/ (the root)
  return rel[0]
}

/**
 * Resolve a relative import specifier to the layer it lands in. Returns null
 * for a same-directory import (`./x`) — those are never cross-layer.
 */
function importTargetLayer(fromAbs, spec) {
  if (!spec.startsWith('.')) return null // bare module (react, js-yaml, …)
  const fromDir = dirname(fromAbs)
  // Resolve `..` / `.` segments against the importing file's directory.
  const resolved = join(fromDir, spec)
  return layerOf(resolved)
}

const IMPORT_RE = /(?:import[\s\S]*?from|export[\s\S]*?from)\s*['"]([^'"]+)['"]/g

describe('dependency-direction guardrail', () => {
  it('never draws a cross-layer import the layer model forbids', () => {
    const offenders = []
    for (const abs of collectSourceFiles(srcDir)) {
      const rel = relative(srcDir, abs)
      if (ROOT_FILES.has(rel)) continue
      const fromLayer = layerOf(abs)
      if (fromLayer == null) continue // root-level file, skip
      const allowed = ALLOWED[fromLayer]
      if (allowed === undefined) {
        offenders.push(`${rel}: file lives in unknown layer "${fromLayer}" — add it to ALLOWED`)
        continue
      }
      const text = readFileSync(abs, 'utf8')
      let m
      while ((m = IMPORT_RE.exec(text)) !== null) {
        const targetLayer = importTargetLayer(abs, m[1])
        if (targetLayer == null) continue // bare module or same-directory import
        if (targetLayer === fromLayer) continue // sibling file
        if (!allowed.includes(targetLayer)) {
          offenders.push(
            `${rel}: imports "${m[1]}" → layer "${targetLayer}", which "${fromLayer}" may not import ` +
              `(allowed: ${allowed.length ? allowed.join(', ') : 'none'})`
          )
        }
      }
    }
    expect(offenders, offenders.join('\n')).toHaveLength(0)
  })

  it('keeps rules/ as the domain heart, not a dependency sink (Schema only)', () => {
    // A focused restatement of the single most important invariant, so a
    // regression here reads clearly rather than as a generic arrow failure.
    expect(ALLOWED.rules).toEqual(['schema'])
  })
})

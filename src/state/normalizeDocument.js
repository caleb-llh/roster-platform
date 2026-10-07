/**
 * Back-compat normalization shim — the parse boundary's anti-corruption step.
 *
 * The word "roster" historically keyed TWO distinct things in stored YAML:
 *   - the per-event positional slot array (nested `roster:` under each event), and
 *   - the scheduling-window period block (`roster: { start_date, end_date }`).
 * Both now have unambiguous canonical keys (`slots` and `roster_period`). This
 * shim rewrites any legacy document into the canonical shape ONCE, at load, so
 * the entire interior (adapter, validators, engine, read model) only ever sees
 * canonical names. See specs/glossary.md → the three senses of "roster".
 *
 * Disambiguation is by SHAPE, not guesswork:
 *   - a `roster` on an EVENT is the slot array  → `slots`
 *   - a `roster` that is the period block (top-level, or per-roster inside a
 *     tenant's `teams[].rosters[]`) is `{ start_date / end_date }` → `roster_period`
 *
 * Idempotent: a document already using `slots`/`roster_period` passes through
 * unchanged (there is nothing left named `roster` in those positions). Kept
 * permanently so pre-existing user files keep loading.
 *
 * Pure: returns a new document; never mutates the input.
 */

/** Rename an event's legacy `roster` slot array to `slots` (if present). */
function normalizeEvent(event) {
  if (!event || typeof event !== 'object') return event
  if (!('roster' in event)) return event
  const { roster, ...rest } = event
  // `slots` wins if both somehow present (already-canonical input is preferred).
  return 'slots' in rest ? { ...rest } : { ...rest, slots: roster }
}

/** Rename a legacy period block `roster` to `roster_period` on a doc/roster node. */
function withRenamedPeriod(node) {
  if (!node || typeof node !== 'object' || !('roster' in node)) return node
  const { roster, ...rest } = node
  return 'roster_period' in rest ? { ...rest } : { ...rest, roster_period: roster }
}

/** Normalize the events array of a flat-or-nested roster node (slot arrays). */
function withNormalizedEvents(node) {
  if (!node || !Array.isArray(node.events)) return node
  return { ...node, events: node.events.map(normalizeEvent) }
}

/**
 * Normalize a document to canonical field names. Accepts the flat shape or the
 * nested-tenant shape (top-level `teams`); both legacy and canonical input are
 * fine. Returns the input unchanged when falsy.
 */
export function normalizeDocument(document) {
  if (!document || typeof document !== 'object') return document

  // Nested-tenant shape: normalize each roster's period block + its events.
  if (Array.isArray(document.teams)) {
    return {
      ...document,
      teams: document.teams.map(team => {
        if (!team || typeof team !== 'object') return team
        const rosters = Array.isArray(team.rosters)
          ? team.rosters.map(r => withNormalizedEvents(withRenamedPeriod(r)))
          : team.rosters
        return { ...team, rosters }
      }),
    }
  }

  // Flat shape: top-level period block + top-level events.
  return withNormalizedEvents(withRenamedPeriod(document))
}

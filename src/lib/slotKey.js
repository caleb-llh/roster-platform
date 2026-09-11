/**
 * The slot-key primitive: the `"<date>#<roleIndex>"` string that identifies a
 * single roster slot across the app.
 *
 * It is a pure, domain-free string format (a leaf) — deliberately in `lib/`
 * rather than a domain layer — because it is shared by both the UI (EventsView's
 * multi-select + the diff overlay) and the Session `bulkClear` command. Keeping
 * one definition here prevents the two sides from drifting; `rosterDiff` and the
 * bulk-clear helper both consume it instead of redefining it locally.
 */

/** `date#roleIndex` — the shared roster-slot key. */
export const slotKey = (date, roleIndex) => `${date}#${roleIndex}`

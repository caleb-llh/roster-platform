import { formatDate } from '../design/colorUtils'

// Per-status presentation for a change row. Mirrors the inline diff dot colours
// (amber=changed, emerald=added, rose=removed) so the review list and the
// in-roster markers read as the same language.
const STATUS_META = {
  added: { label: 'Added', cls: 'text-emerald-700', dot: 'bg-emerald-500' },
  removed: { label: 'Removed', cls: 'text-rose-700', dot: 'bg-rose-500' },
  changed: { label: 'Changed', cls: 'text-amber-700', dot: 'bg-amber-500' },
}

/**
 * Reviewable list of the uncommitted draft changes, grouped by event date —
 * the IDE-copilot-style "view the changes before you save" surface. Read-only:
 * Save / Discard act on the whole draft (see the draft/commit spec). Rendered
 * inside the uncommitted-changes bar when expanded.
 *
 * @param {object[]} slotChanges  from computeRosterDiff().slotChanges
 * @param {(id: string|null) => string|null} getMemberName
 */
export default function ChangeReviewPanel({ slotChanges, getMemberName }) {
  if (!slotChanges || slotChanges.length === 0) return null

  // Group by event date, preserving first-seen order.
  const groups = []
  const byDate = new Map()
  for (const c of slotChanges) {
    let group = byDate.get(c.date)
    if (!group) {
      group = { date: c.date, name: c.name, changes: [] }
      byDate.set(c.date, group)
      groups.push(group)
    }
    group.changes.push(c)
  }
  groups.sort((a, b) => a.date.localeCompare(b.date))

  return (
    <div className="max-h-72 overflow-y-auto border-t border-amber-200 bg-white/70">
      <ul className="divide-y divide-amber-100">
        {groups.map(group => (
          <li key={group.date} className="px-3 sm:px-6 lg:px-8 py-2">
            <div className="mb-1 flex items-baseline gap-2">
              <span className="text-xs font-semibold text-gray-900">{formatDate(group.date)}</span>
              {group.name && <span className="truncate text-xs text-gray-500">{group.name}</span>}
            </div>
            <ul className="space-y-1">
              {group.changes.map(c => {
                const meta = STATUS_META[c.status] || STATUS_META.changed
                const before = getMemberName(c.before)
                const after = getMemberName(c.after)
                return (
                  <li
                    key={`${c.date}#${c.roleIndex}`}
                    className="flex items-center gap-2 text-xs text-gray-700"
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
                    <span className={`w-16 shrink-0 font-medium ${meta.cls}`}>{meta.label}</span>
                    <span className="shrink-0 font-medium text-gray-900">{c.role}</span>
                    <span className="min-w-0 truncate text-gray-600">
                      {c.status === 'added' && <span className="text-emerald-700">{after || 'unassigned'}</span>}
                      {c.status === 'removed' && <span className="text-gray-400 line-through">{before || 'unassigned'}</span>}
                      {c.status === 'changed' && (
                        <>
                          <span className="text-gray-400 line-through">{before || 'unassigned'}</span>
                          <span className="mx-1 text-gray-400">→</span>
                          <span className="text-gray-900">{after || 'unassigned'}</span>
                        </>
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  )
}

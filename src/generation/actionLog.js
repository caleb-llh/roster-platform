/**
 * Verbose action logger for roster operations.
 *
 * A lightweight, structured collector threaded through the generator and future
 * manual edit handlers. It records every meaningful decision (greedy
 * assignments, eligibility rejections, each local-search move
 * considered/applied, and — later — manual swaps/updates/deletes/inserts) so
 * the UI can render a discrete, human-readable trace.
 *
 * Design goals:
 *  - Zero cost when disabled (enabled=false short-circuits every call).
 *  - Structured entries { level, category, group, message, data } so callers
 *    can render or filter later, plus a flat text form for quick display.
 *  - Generic enough to capture any roster action (generation, and future
 *    manual swaps / updates / deletes / inserts), not just algorithm output.
 */

export class ActionLogger {
  constructor(enabled = true, category = 'generation') {
    this.enabled = enabled
    this.entries = []
    this._category = category // default category for entries from this logger
    this._group = null // current run/phase label for context
  }

  _push(level, message, data) {
    if (!this.enabled) return
    this.entries.push({
      level,
      category: this._category,
      group: this._group,
      message,
      data,
    })
  }

  group(label) { this._group = label }

  debug(message, data) { this._push('debug', message, data) }
  info(message, data) { this._push('info', message, data) }
  warn(message, data) { this._push('warn', message, data) }
  success(message, data) { this._push('success', message, data) }

  /** Flat, human-readable log lines for text display / copy. */
  toLines() {
    return this.entries.map(formatEntry)
  }
}

/** Format a single structured entry into a human-readable line. */
export function formatEntry(e) {
  const grp = e.group ? `[${e.group}] ` : ''
  const icon = LEVEL_ICON[e.level] || '•'
  const extra = e.data !== undefined ? '  ' + formatData(e.data) : ''
  return `${icon} ${grp}${e.message}${extra}`
}

/** A no-op logger used when logging is disabled (keeps call sites clean). */
export const NULL_LOGGER = new ActionLogger(false)

const LEVEL_ICON = {
  debug: '·',
  info: 'ℹ',
  warn: '⚠',
  success: '✓',
}

function formatData(data) {
  if (data == null) return ''
  if (typeof data === 'string') return data
  try {
    return JSON.stringify(data)
  } catch {
    return String(data)
  }
}

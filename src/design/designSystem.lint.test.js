/**
 * Design-system guardrail (dependency-free lint via Vitest).
 *
 * The repo has no ESLint, so this test *is* the guardrail: it scans the JSX/JS
 * sources for class strings that must instead flow through a named token in
 * `designSystem.js` (see specs/design-system.md, the binding spec). It is
 * intentionally HIGH-SIGNAL, not exhaustive — it flags the
 * unambiguous mistakes (copy-pasting a glass token's literal string, or using a
 * banned decorative hue) rather than every raw utility, so it never fights the
 * many legitimate one-off surfaces (hover states, the dark log console, the
 * day-pill scroller, etc.).
 *
 * Two allowlisted files may contain raw strings:
 *   - `designSystem.js` — it *defines* the tokens.
 *   - the design-system reference page — it *renders* every token verbatim.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'

import {
  glassPanel,
  glassCard,
  glassMenu,
  glassModal,
  glassFab,
  draftBar,
} from './designSystem'

const here = dirname(fileURLToPath(import.meta.url))
const srcDir = join(here, '..')

/** Files that are allowed to contain raw token strings. */
const ALLOWLIST = new Set([
  join('design', 'designSystem.js'), // defines the tokens
  join('components', 'DesignSystem.jsx'), // renders every token verbatim
])

/**
 * Recursively collect the source files we lint. Tests are skipped (they assert
 * on class strings on purpose).
 */
function collectSourceFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) {
      out.push(...collectSourceFiles(abs))
      continue
    }
    if (!/\.(jsx|js)$/.test(name)) continue
    if (/\.test\.jsx?$/.test(name)) continue
    if (/setup\.js$/.test(name)) continue
    out.push(abs)
  }
  return out
}

const sourceFiles = collectSourceFiles(srcDir).filter((abs) => {
  const rel = relative(srcDir, abs).split(sep).join(sep)
  return !ALLOWLIST.has(rel)
})

/**
 * Banned literal token strings: if any of these exact glass strings appears in
 * a file, it was copy-pasted instead of imported from `designSystem.js`.
 */
const BANNED_LITERALS = [
  { value: glassPanel, token: 'glassPanel' },
  { value: glassCard, token: 'glassCard' },
  { value: glassMenu, token: 'glassMenu' },
  { value: glassModal, token: 'glassModal' },
  { value: glassFab, token: 'glassFab' },
  { value: draftBar, token: 'draftBar' },
]

/**
 * Banned regex patterns for decorative hues that the spec removed. `yellow-*`
 * warnings were unified onto `amber-*`; keeping this at zero locks that in.
 */
const BANNED_PATTERNS = [
  {
    re: /\byellow-\d/,
    hint: 'warnings are unified on amber; use semanticWarning / warningChip (no yellow-*)',
  },
]

describe('design-system guardrail', () => {
  it('never inlines a glass token string (import from designSystem instead)', () => {
    const offenders = []
    for (const abs of sourceFiles) {
      const text = readFileSync(abs, 'utf8')
      for (const { value, token } of BANNED_LITERALS) {
        if (text.includes(value)) {
          offenders.push(`${relative(srcDir, abs)}: inlines "${token}" — import { ${token} } from designSystem`)
        }
      }
    }
    expect(offenders, offenders.join('\n')).toHaveLength(0)
  })

  it('never uses a banned decorative hue', () => {
    const offenders = []
    for (const abs of sourceFiles) {
      const lines = readFileSync(abs, 'utf8').split('\n')
      lines.forEach((line, i) => {
        for (const { re, hint } of BANNED_PATTERNS) {
          if (re.test(line)) {
            offenders.push(`${relative(srcDir, abs)}:${i + 1}: ${hint}`)
          }
        }
      })
    }
    expect(offenders, offenders.join('\n')).toHaveLength(0)
  })
})

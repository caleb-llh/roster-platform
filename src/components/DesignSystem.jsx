/**
 * Living design-system reference page.
 *
 * A lightweight, standalone visual catalogue of every design token in
 * `designSystem.js` and every shared primitive in `SharedComponents.jsx`. It is
 * the reference new work should look at so the app stays consistent (see
 * specs/design-system.md, the binding spec).
 *
 * It is reached via the `#design` hash (see `main.jsx`) so it needs no router
 * and stays out of the authenticated data flow. This file is allowlisted by the
 * design-system guardrail test because it renders raw token strings verbatim.
 */
import * as theme from '../design/designSystem'
import { COLOR_PALETTE, DAY_CARD_COLORS } from '../design/colorUtils'
import {
  StatTile,
  GlassFab,
  IssueSummary,
  ModalHeader,
  ModalCloseButton,
} from './SharedComponents'

const {
  tierTitle,
  tierSection,
  tierLabel,
  tierUnit,
  helperText,
  headingPage,
  headingModal,
  glassPanel,
  glassCard,
  glassPopup,
  glassMenu,
  glassModal,
  modalBackdrop,
  btnPrimary,
  btnNeutral,
  btnDanger,
  monoChip,
  hoverRow,
  tabActive,
  tabInactive,
  semanticError,
  semanticWarning,
  draftBar,
  errorChip,
  warningChip,
  ringError,
  ringWarning,
} = theme

/** Section wrapper — a glass panel with a Tier-2 header. */
function Section({ title, children }) {
  return (
    <section className={`${glassPanel} p-4 sm:p-6`}>
      <h2 className={`${tierSection} mb-4`}>{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

/** A single token row: the rendered sample + its export name + raw string. */
function Token({ name, children, note }) {
  return (
    <div className="flex flex-col gap-1 border-b border-white/40 pb-3 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4">
      <div className="sm:w-1/2">{children}</div>
      <div className="sm:w-1/2">
        <code className="text-xs font-semibold text-gray-700">{name}</code>
        {note && <p className={`${helperText} mt-0.5`}>{note}</p>}
      </div>
    </div>
  )
}

export default function DesignSystem() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200 p-4 sm:p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className={`${glassPanel} p-4 sm:p-6`}>
          <h1 className={headingPage}>Design system</h1>
          <p className={`${helperText} mt-1`}>
            Every token in <code>designSystem.js</code> and every shared primitive.
            The reference for keeping new UI consistent. Reached via
            <code> #design</code>.
          </p>
        </header>

        {/* --- Typography tiers --- */}
        <Section title="Typography (chrome)">
          <Token name="headingPage" note="Page / view H1 (proper name, normal-case)">
            <span className={headingPage}>Heading page</span>
          </Token>
          <Token name="headingModal" note="Modal / drawer H2">
            <span className={headingModal}>Heading modal</span>
          </Token>
          <Token name="tierTitle" note="Tier 1 — panel title">
            <span className={tierTitle}>Panel title</span>
          </Token>
          <Token name="tierSection" note="Tier 2 — section header">
            <span className={tierSection}>Section header</span>
          </Token>
          <Token name="tierLabel" note="Tier 3 — small label">
            <span className={tierLabel}>Small label</span>
          </Token>
          <Token name="tierUnit" note="Tier 3 (muted) — axis caption / unit">
            <span className={tierUnit}>Unit caption</span>
          </Token>
          <Token name="helperText" note="Descriptive prose, recedes behind data">
            <span className={helperText}>Helper sentence text.</span>
          </Token>
        </Section>

        {/* --- Surfaces --- */}
        <Section title="Surfaces (glass)">
          <Token name="glassPanel" note="Outer panel">
            <div className={`${glassPanel} p-3 text-sm text-gray-700`}>glassPanel</div>
          </Token>
          <Token name="glassCard" note="Inner card / tile / well">
            <div className={`${glassCard} p-3 text-sm text-gray-700`}>glassCard</div>
          </Token>
          <Token name="glassPopup" note="Popup / tooltip body">
            <div className={`${glassPopup} p-3 text-sm`}>glassPopup</div>
          </Token>
          <Token name="glassMenu" note="Dropdown / context menu">
            <div className={`${glassMenu} p-3 text-sm text-gray-700`}>glassMenu</div>
          </Token>
          <Token name="glassModal" note="Modal panel">
            <div className={`${glassModal} p-3 text-sm text-gray-700`}>glassModal</div>
          </Token>
          <Token name="modalBackdrop" note="Dimmed, blurred backdrop">
            <div className={`${modalBackdrop} p-3 text-sm text-white rounded`}>modalBackdrop</div>
          </Token>
        </Section>

        {/* --- Controls --- */}
        <Section title="Controls">
          <Token name="btnPrimary">
            <button className={`${btnPrimary} px-4 py-2 text-sm`}>Primary</button>
          </Token>
          <Token name="btnNeutral">
            <button className={`${btnNeutral} px-4 py-2 text-sm`}>Neutral</button>
          </Token>
          <Token name="btnDanger" note="Semantic red is intentional">
            <button className={`${btnDanger} px-4 py-2 text-sm`}>Danger</button>
          </Token>
          <Token name="monoChip" note="Neutral decorative chip">
            <span className={`${monoChip} inline-block rounded px-2 py-0.5 text-xs`}>chip</span>
          </Token>
          <Token name="hoverRow" note="Neutral row / menu-item hover">
            <div className={`${hoverRow} rounded p-2 text-sm text-gray-700`}>Hover me</div>
          </Token>
          <Token name="tabActive / tabInactive">
            <div className="flex gap-4 border-b border-gray-200">
              <span className={`${tabActive} pb-1 text-sm`}>Active</span>
              <span className={`${tabInactive} pb-1 text-sm`}>Inactive</span>
            </div>
          </Token>
        </Section>

        {/* --- Semantic feedback --- */}
        <Section title="Semantic feedback (accent glass)">
          <Token name="semanticError">
            <div className={`${semanticError} rounded p-2 text-sm`}>Error surface</div>
          </Token>
          <Token name="semanticWarning" note="Warnings unified on amber (not yellow)">
            <div className={`${semanticWarning} rounded p-2 text-sm`}>Warning surface</div>
          </Token>
          <Token name="draftBar" note="The one saturated surface — highest-urgency 'unsaved changes' chrome">
            <div className={`${draftBar} rounded p-2 text-sm text-amber-900`}>3 unsaved changes</div>
          </Token>
          <Token name="errorChip">
            <span className={`${errorChip} inline-block rounded px-2 py-0.5 text-xs`}>error</span>
          </Token>
          <Token name="warningChip">
            <span className={`${warningChip} inline-block rounded px-2 py-0.5 text-xs`}>warning</span>
          </Token>
          <Token name="ringError">
            <div className={`${ringError} ${glassCard} p-2 text-sm text-gray-700`}>ringError</div>
          </Token>
          <Token name="ringWarning">
            <div className={`${ringWarning} ${glassCard} p-2 text-sm text-gray-700`}>ringWarning</div>
          </Token>
        </Section>

        {/* --- Z-index scale --- */}
        <Section title="Z-index scale (stacking order)">
          {[
            ['zInCard', theme.zInCard, 'Card-local overlays (slot pickers, badges)'],
            ['zSticky', theme.zSticky, 'Pinned chrome: draft bar, tabs, select toolbar, month selector, menus'],
            ['zPopover', theme.zPopover, 'Dropdowns/pickers that must escape sticky chrome; the FAB cluster'],
            ['zToast', theme.zToast, 'Transient toasts — above sticky/popovers, below modals'],
            ['zModal', theme.zModal, 'Modals, the YAML drawer, and their backdrops (topmost)'],
          ].map(([name, cls, note]) => (
            <Token key={name} name={name} note={note}>
              <code className={`inline-block rounded px-2 py-0.5 text-xs ${monoChip}`}>{cls}</code>
            </Token>
          ))}
        </Section>

        {/* --- Functional colour --- */}
        <Section title="Functional colour (text-only)">
          <Token name="COLOR_PALETTE" note="Role hues — coloured font, never a filled pill">
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm font-medium">
              {COLOR_PALETTE.map((c, i) => (
                <span key={i} className={c}>role{i}</span>
              ))}
            </div>
          </Token>
          <Token name="DAY_CARD_COLORS" note="Day-of-week label hues">
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm font-medium">
              {DAY_CARD_COLORS.map((c, i) => (
                <span key={i} className={c}>day{i}</span>
              ))}
            </div>
          </Token>
          <Token name="role tag" note="Coloured font inside a neutral outline; understudy = dashed">
            <div className="flex gap-2">
              <span className={`rounded border border-gray-200/70 bg-white/30 px-1.5 py-0.5 text-xs font-medium ${COLOR_PALETTE[0]}`}>Role</span>
              <span className={`rounded border border-dashed border-gray-300/70 bg-white/30 px-1.5 py-0.5 text-xs font-medium ${COLOR_PALETTE[1]}`}>Understudy</span>
            </div>
          </Token>
        </Section>

        {/* --- Shared primitives --- */}
        <Section title="Shared primitives">
          <Token name="StatTile">
            <div className="grid grid-cols-3 gap-2">
              <StatTile value="12" label="Members" />
              <StatTile value="7" label="Events" />
              <StatTile value="3" label="Roles" />
            </div>
          </Token>
          <Token name="IssueSummary" note="Dot+number + caret dropdown (click to open)">
            <IssueSummary
              errorCount={1}
              warningCount={2}
              items={[
                { level: 'error', label: 'Alice', msg: 'unavailable Sunday' },
                { level: 'warning', label: 'Bob', msg: 'over preferred load' },
                { level: 'warning', label: 'Cara', msg: 'no preferred role' },
              ]}
            />
          </Token>
          <Token name="GlassFab" note="Round floating action button">
            <GlassFab title="Example" className="h-12 w-12 text-xl">+</GlassFab>
          </Token>
          <Token name="ModalHeader + ModalCloseButton">
            <div className={`${glassModal} overflow-hidden`}>
              <ModalHeader title="Modal title" onClose={() => {}} />
              <div className="p-4 text-sm text-gray-600">Body content.</div>
            </div>
          </Token>
          <Token name="ModalCloseButton (standalone)">
            <ModalCloseButton onClick={() => {}} />
          </Token>
        </Section>
      </div>
    </div>
  )
}

/**
 * Reusable, app-wide design system.
 *
 * Shared Tailwind class-string tokens so every surface stays visually
 * consistent and tunable in one place. The look is: **light, glassmorphism,
 * monochrome slate/gray chrome** with uppercase tracked "chrome" typography.
 * Families:
 *
 *   1. Typography tiers — a 3-tier uppercase/weight/tracking hierarchy for
 *      *chrome* (titles, section headers, small labels/units). Chrome uses
 *      uppercase thin/tracked type; DATA (member names, role names, numbers
 *      supplied by the YAML) stays normal-case and is NOT part of this system.
 *   2. Surfaces — glassmorphism panels/cards/menus/modals + the glass tooltip.
 *   3. Controls — buttons (mono primary / neutral / danger), tabs, chips.
 *
 * Colour policy (decided with the user):
 *   - **Decorative** accents (formerly assorted blue/green/purple used just for
 *     looks) are monochromatized to slate/gray. Blue is no longer a brand hue.
 *   - **Semantic** colour is KEPT but toned onto glass surfaces: red = error /
 *     destructive, amber = warning / unsaved, and the diff triad
 *     emerald=added / amber=changed / rose=removed. These carry meaning and
 *     must not be flattened away.
 *   - **Functional** role/day colour (see `colorUtils.js`) is kept but *muted*
 *     so it harmonizes with the glass look while still distinguishing roles.
 *
 * Design decisions worth preserving:
 *   - Tier 1 uses `tracking-wide` (0.025em), NOT `tracking-[0.2em]`: at the
 *     title's small size, very wide letter-spacing left distracting gaps
 *     between letters, so tracking is kept modest and hierarchy is carried by
 *     weight + size instead.
 *   - `helperText` (descriptive sentence-form text that is NOT uppercase/thin)
 *     is a muted `text-gray-400` so prose recedes behind the data and the
 *     labelled chrome — but not so faint (an earlier `text-gray-300` pass) that
 *     it becomes hard to read.
 */

// --- Typography tiers (chrome only) ---

/** Tier 1 — panel title. */
export const tierTitle = 'text-sm font-semibold uppercase tracking-wide text-gray-800'

/** Tier 2 — section headers within a panel. */
export const tierSection = 'text-[11px] font-semibold uppercase tracking-wider text-gray-500'

/** Tier 3 — small labels / units / captions. */
export const tierLabel = 'text-[11px] font-medium uppercase tracking-wider text-gray-500'

/** Tier 3 (muted) — axis captions / inline units, the quietest chrome. */
export const tierUnit = 'text-[11px] font-normal uppercase tracking-wide text-gray-400'

/**
 * Descriptive sentence-form helper text (normal-case, not thin). Lighter than
 * Tier-3 labels so prose recedes behind data and labelled chrome.
 */
export const helperText = 'text-xs text-gray-400'

// --- Surfaces (glassmorphism) ---

/** Outer glass panel. */
export const glassPanel = 'bg-white/40 backdrop-blur-md border border-white/30 rounded-lg shadow-lg'

/** Inner glass card (summary tiles, chart wells). */
export const glassCard = 'bg-white/50 backdrop-blur-sm rounded-lg border border-white/40 shadow-sm'

/** Glass popup/tooltip body (used by BellCurve popup and the timeline Tooltip). */
export const glassPopup = 'rounded-md border border-white/60 bg-white/80 text-slate-700 shadow-lg backdrop-blur-md'

/** The rotated-square arrow that anchors a glass popup to its target. */
export const glassArrow = 'rotate-45 border-b border-r border-white/60 bg-white/80'

/** Dropdown / context menu surface (replaces opaque `bg-white shadow-lg` menus). */
export const glassMenu = 'rounded-lg border border-white/50 bg-white/80 shadow-lg backdrop-blur-md'

/** Modal panel surface (replaces opaque `bg-white shadow-2xl` dialogs). */
export const glassModal = 'rounded-2xl border border-white/50 bg-white/80 shadow-2xl backdrop-blur-xl'

/** Standard dimmed, blurred modal backdrop. */
export const modalBackdrop = 'bg-black/30 backdrop-blur-sm'

// --- Z-index scale (stacking order, low → high) ---
//
// A single ladder so overlapping layers don't fight (the bug: an `z-40` issue
// dropdown was painted UNDER the `z-40` sticky select toolbar). Rule of thumb:
// something that opens ON TOP of another layer must sit one rung above it.
//   inCard  (10) — overlays local to a card (a slot picker, a diff badge)
//   sticky  (30) — pinned chrome: draft bar, mobile tabs, select toolbar,
//                  month selector, header action menu
//   popover (40) — dropdowns/pickers that must escape sticky chrome (the
//                  Events issue dropdown, slot pickers opened from a pill)
//   toast   (45) — transient toasts (above sticky + popovers, below modals)
//   modal   (50) — modals, the YAML drawer, and their backdrops (topmost)
/** Card-local overlay (slot pickers, badges inside a card). */
export const zInCard = 'z-10'
/** Pinned/sticky chrome (draft bar, tabs, select toolbar, month selector, menus). */
export const zSticky = 'z-30'
/** Dropdowns/pickers that must sit above sticky chrome. */
export const zPopover = 'z-40'
/** Transient toasts — above sticky + popovers, below modals. */
export const zToast = 'z-[45]'
/** Modals, drawers, and their backdrops (topmost). */
export const zModal = 'z-50'

// --- Heading tiers (larger page/section titles, still monochrome) ---

/** Page H1 (app title, view titles). Normal-case (it's a proper name/title). */
export const headingPage = 'text-xl sm:text-2xl font-bold tracking-tight text-gray-900'

/** Modal / drawer H2. */
export const headingModal = 'text-lg font-semibold tracking-tight text-gray-900'

// --- Controls ---

/** Primary action button — monochrome (blue/amber CTAs are recolored to this). */
export const btnPrimary = 'bg-gray-800 hover:bg-gray-900 text-white rounded-lg font-medium transition-colors'

/** Neutral / secondary button (glass-friendly ghost). */
export const btnNeutral = 'bg-white/60 backdrop-blur-sm border border-gray-300/60 text-gray-700 hover:bg-white/90 rounded-lg font-medium transition-colors'

/** Destructive button — semantic red is intentionally kept. */
export const btnDanger = 'bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors'

/** Round floating action button (glass). Shared by the App FABs. */
export const glassFab = 'flex items-center justify-center rounded-full bg-white/80 backdrop-blur-md border border-gray-300/50 text-gray-700 shadow-lg hover:bg-white active:scale-95 transition-all touch-manipulation'

/** Neutral decorative chip (replaces blue/green/purple decorative chips). */
export const monoChip = 'bg-gray-100/70 text-gray-600 border border-gray-200/60'

/** Neutral row/menu-item hover (replaces decorative `hover:bg-blue-50`). */
export const hoverRow = 'hover:bg-gray-500/10'

/** Active tab (was `text-blue-600 border-blue-500`). */
export const tabActive = 'text-gray-900 border-b-2 border-gray-700'

/** Inactive tab. */
export const tabInactive = 'text-gray-500 hover:text-gray-800'

// --- Semantic feedback surfaces (accent-only, glass) ---
//
// Errors/warnings must still *read* as red/amber, but on the same frosted
// glass as everything else — the colour is carried by a thin left-border +
// muted text on a near-glass tint, NOT a saturated fill. Softer than the old
// `bg-red-100 border-red-300 text-red-800` badges, which shouted against the
// translucent UI. Warnings are unified on **amber** (warmer, matches the draft
// bar and the diff "changed" hue) rather than yellow.

/** Error panel/row surface (was `bg-red-50 border-red-500`). */
export const semanticError = 'bg-red-50/50 backdrop-blur-sm border-l-2 border-red-300/70 text-red-700'

/** Warning panel/row surface (was `bg-yellow-50 border-yellow-400`). */
export const semanticWarning = 'bg-amber-50/50 backdrop-blur-sm border-l-2 border-amber-300/70 text-amber-700'

// The pinned "unsaved changes" draft bar is intentionally the ONE saturated
// surface in the app: it is the highest-urgency chrome ("act now — Save or
// Discard"), so it uses a solid amber fill rather than the near-glass
// `semanticWarning` tint. Centralised here so the guardrail + design page can
// cover it and it isn't re-hand-rolled. Buttons inside it use `btnPrimary` /
// `btnNeutral` like every other CTA.
/** Pinned draft/unsaved-changes bar surface (intentional saturated amber). */
export const draftBar = 'border-b border-amber-300 bg-amber-50/95 backdrop-blur-md'

/** Small error badge/pill (was `bg-red-100 text-red-800 border-red-300`). */
export const errorChip = 'bg-red-50/70 backdrop-blur-sm text-red-700 border border-red-200/60'

/** Small warning badge/pill (was `bg-yellow-100 text-yellow-800 border-yellow-300`). */
export const warningChip = 'bg-amber-50/70 backdrop-blur-sm text-amber-700 border border-amber-200/60'

/** Soft attention ring for a whole card (was `ring-2 ring-red-500`). */
export const ringError = 'ring-1 ring-red-300/60'

/** Soft attention ring for a whole card (was `ring-2 ring-yellow-500`). */
export const ringWarning = 'ring-1 ring-amber-300/60'

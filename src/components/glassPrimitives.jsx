import { useState, useRef } from 'react'
import { semanticError, glassMenu, tierSection, glassCard, glassFab, tierLabel, zPopover, modalBackdrop, glassModal, zModal } from '../design/designSystem'
import { useClickOutside } from '../lib/useClickOutside'

/** Standard modal "×" close button. */
export const ModalCloseButton = ({ onClick, className = '' }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label="Close"
    className={`text-gray-400 hover:text-gray-600 transition-colors ${className}`}
  >
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  </button>
)

/** Standard modal header: title (headingModal-ish) + close button on one bar.
 *  Any `children` render next to the title (e.g. a status badge). */
export const ModalHeader = ({ title, onClose, children }) => (
  <div className="flex items-center justify-between border-b border-white/40 px-4 sm:px-6 py-3 sm:py-4">
    <div className="flex min-w-0 items-center gap-2">
      <h2 className="text-lg font-semibold tracking-tight text-gray-900">{title}</h2>
      {children}
    </div>
    {onClose && <ModalCloseButton onClick={onClose} />}
  </div>
)

/** Standard modal shell: fixed backdrop (click to close) + centered glass panel
 *  + shared ModalHeader + a scrollable body + an optional footer. This is the
 *  one centered-modal chrome; modals supply only their title/body/footer and
 *  never re-roll the backdrop/panel/header. (Drawers -- e.g. YamlDrawer -- are a
 *  different shell and only share ModalHeader, not this.) `size` picks the panel
 *  max-width; `titleExtra` renders next to the title (e.g. a status badge). */
export const ModalShell = ({ title, titleExtra, onClose, footer, size = 'md', children }) => {
  const maxW = size === 'lg' ? 'max-w-3xl' : 'max-w-md'
  return (
    <div className={`fixed inset-0 ${zModal} flex items-center justify-center p-2 sm:p-4`}>
      <div className={`absolute inset-0 ${modalBackdrop}`} onClick={onClose} />
      <div className={`relative z-10 flex max-h-[90vh] w-full ${maxW} flex-col overflow-hidden ${glassModal}`}>
        <ModalHeader title={title} onClose={onClose}>{titleExtra}</ModalHeader>
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-5">
          {children}
        </div>
        {footer && (
          <div className="border-t border-gray-200 bg-gray-50/80 px-4 sm:px-6 py-3 sm:py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

/** Glass stat tile: a big number with an uppercase caption below. */
export const StatTile = ({ value, label, className = '' }) => (
  <div className={`${glassCard} p-3 text-center ${className}`}>
    <div className="text-2xl font-bold text-gray-800">{value}</div>
    <div className={`mt-1 ${tierLabel}`}>{label}</div>
  </div>
)

/** Round glass floating action button. */
export const GlassFab = ({ onClick, disabled, title, className = '', children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={`${glassFab} disabled:opacity-40 disabled:pointer-events-none ${className}`}
  >
    {children}
  </button>
)

// Compact validation summary: coloured dot(s) + count(s) with a disclosure
// caret that toggles a dropdown listing the individual issues. Used next to
// the Events and Members headings so both surfaces present errors/warnings the
// same way (click to open — no hover). Each item is { level, label?, msg }.
export const IssueSummary = ({ errorCount = 0, warningCount = 0, items = [] }) => {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useClickOutside(ref, () => setOpen(false), open)

  if (errorCount === 0 && warningCount === 0) return null

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label="View validation issues"
        className="flex items-center gap-1.5 text-xs font-semibold"
      >
        {errorCount > 0 && (
          <span className="flex items-center gap-1 text-red-600">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-400" />
            {errorCount}
          </span>
        )}
        {warningCount > 0 && (
          <span className="flex items-center gap-1 text-amber-600">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
            {warningCount}
          </span>
        )}
        <span className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && (
        <div className={`absolute left-0 top-full ${zPopover} mt-1 w-72 max-h-64 overflow-y-auto p-2 ${glassMenu}`}>
          <div className={`px-1 pb-1 ${tierSection}`}>
            {errorCount} {errorCount === 1 ? 'Error' : 'Errors'} · {warningCount} {warningCount === 1 ? 'Warning' : 'Warnings'}
          </div>
          <ul className="space-y-1">
            {items.map((issue, idx) => (
              <li key={idx} className="flex items-start gap-1.5 rounded px-1 py-0.5 text-xs">
                <span className={`mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${issue.level === 'error' ? 'bg-red-400' : 'bg-amber-400'}`} />
                <span className="text-gray-600">
                  {issue.label && <span className="font-medium text-gray-800">{issue.label}</span>}
                  {issue.label ? ' — ' : ''}{issue.msg}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export const ErrorDisplay = ({ title, message, hint }) => (
  <div className="min-h-screen bg-slate-50 p-8">
    <div className="max-w-4xl mx-auto">
      <div className={`p-6 rounded-lg ${semanticError}`}>
        <div className="flex items-center mb-2">
          <svg className="w-6 h-6 text-red-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h2 className="text-lg font-semibold tracking-tight text-red-800">{title}</h2>
        </div>
        {typeof message === 'string' ? (
          <p className="text-red-700 font-mono text-sm">{message}</p>
        ) : (
          <ul className="space-y-2">
            {message.map((err, i) => (
              <li key={i} className="text-red-700 text-sm flex items-start">
                <span className="mr-2">•</span>
                <span>{err}</span>
              </li>
            ))}
          </ul>
        )}
        {hint && <p className="mt-4 text-red-600 text-sm">{hint}</p>}
      </div>
    </div>
  </div>
)

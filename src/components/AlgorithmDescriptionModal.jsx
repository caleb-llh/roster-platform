import { glassCard, btnNeutral } from '../design/designSystem'
import { ModalShell } from './glassPrimitives'

export default function AlgorithmDescriptionModal({ description, onClose }) {
  // `description` is the structured `{ intro, sections }` produced by App's
  // getAlgorithmDescription -- consumed directly, not parsed from prose.
  const { intro, sections } = description

  const footer = (
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
      <p className="text-xs text-gray-500 text-center sm:text-left">Generation is non-destructive — you can always undo it</p>
      <button
        onClick={onClose}
        className={`${btnNeutral} px-4 sm:px-6 py-2.5 text-sm touch-manipulation min-h-[44px]`}
      >
        Close
      </button>
    </div>
  )

  return (
    <ModalShell title="How the Roster Generator Works" onClose={onClose} size="lg" footer={footer}>
      <div className="space-y-4 sm:space-y-5">
        <p className="text-xs sm:text-sm text-gray-600">{intro}</p>

        {sections.map((section, idx) => (
          <div key={idx} className={`${glassCard} p-4 sm:p-5`}>
            <div className="flex items-start gap-2 sm:gap-3">
              <span className="text-xl sm:text-2xl flex-shrink-0">{section.icon}</span>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-gray-900 text-base sm:text-lg mb-2 sm:mb-3">{section.title}</h3>
                <ul className="space-y-2 sm:space-y-2.5">
                  {section.items.map((item, itemIdx) => (
                    <li key={itemIdx} className="flex items-start gap-2 sm:gap-2.5 text-gray-700">
                      <span className="text-gray-500 font-bold mt-0.5 flex-shrink-0">•</span>
                      <span className="text-xs sm:text-sm leading-relaxed">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ))}

        {/* How it works summary */}
        <div className={`${glassCard} p-4 sm:p-5`}>
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2 text-sm sm:text-base">
            When you generate:
          </h3>
          <ul className="space-y-2 text-xs sm:text-sm text-gray-700">
            <li className="flex items-start gap-2">
              <span className="text-gray-500 font-bold mt-0.5 flex-shrink-0">1.</span>
              <span>The system finds the best match for each open slot</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-gray-500 font-bold mt-0.5 flex-shrink-0">2.</span>
              <span>All rules are strictly followed</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-gray-500 font-bold mt-0.5 flex-shrink-0">3.</span>
              <span>Goals are optimized as best as possible</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-gray-500 font-bold mt-0.5 flex-shrink-0">4.</span>
              <span>Results land in a draft you can review or undo (Ctrl/Cmd+Z)</span>
            </li>
          </ul>
        </div>
      </div>
    </ModalShell>
  )
}

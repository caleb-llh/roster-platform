// Global color palette for role tags — Cool Spectrum, muted for the glass look.
// Role tags are rendered as COLOURED FONT on the plain glass surface (no
// coloured pill box), so each entry is a text-colour only. Hue still
// distinguishes roles at a glance while the card/surface stays monochrome,
// matching the roster-stats look. See src/design/designSystem.js colour policy.
export const COLOR_PALETTE = [
  'text-purple-600',    // Muted purple
  'text-violet-600',    // Muted violet
  'text-indigo-600',    // Muted indigo
  'text-blue-600',      // Muted blue
  'text-sky-600',       // Muted sky
  'text-cyan-600',      // Muted cyan
  'text-teal-600',      // Muted teal
  'text-emerald-600',   // Muted emerald
  'text-green-600',     // Muted green
  'text-lime-600',      // Muted lime
]

// Day-of-week cue for event cards. The card body is neutral glass (monochrome,
// matching the roster-stats look) and its coloured border is RESERVED for
// error/warning status. The weekday is instead conveyed by lightly colouring
// the day-of-week LABEL with a single muted hue per weekday, so colour is a
// quiet typographic accent. Must contain a `hover:` class (see test) — hover
// deepens the label slightly. See designSystem.js colour policy.
export const DAY_CARD_COLORS = [
  'text-purple-500 hover:text-purple-600',    // Sunday
  'text-violet-500 hover:text-violet-600',    // Monday
  'text-indigo-500 hover:text-indigo-600',    // Tuesday
  'text-blue-500 hover:text-blue-600',        // Wednesday
  'text-sky-500 hover:text-sky-600',          // Thursday
  'text-cyan-500 hover:text-cyan-600',        // Friday
  'text-teal-500 hover:text-teal-600',        // Saturday
]

// Create a stable color mapping for roles
export const createRoleColorMap = (roles) => {
  const colorMap = {}
  roles.forEach((role, index) => {
    colorMap[role] = COLOR_PALETTE[index % COLOR_PALETTE.length]
  })
  return colorMap
}

// Get card background color based on day of week (0 = Sunday, 6 = Saturday)
export const getCardColorForDay = (dayOfWeek) => {
  return DAY_CARD_COLORS[dayOfWeek % DAY_CARD_COLORS.length]
}

// Date formatting utilities
export const formatDate = (dateString, options = { month: 'short', day: 'numeric' }) => {
  return new Date(dateString).toLocaleDateString('en-US', options)
}

export const formatDateRange = (startDate, endDate) => {
  return `${formatDate(startDate, { month: 'short', day: 'numeric', year: 'numeric' })} - ${formatDate(endDate, { month: 'short', day: 'numeric', year: 'numeric' })}`
}

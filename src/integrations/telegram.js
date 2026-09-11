/**
 * Telegram Mini App integration (optional, no-op outside Telegram).
 *
 * When the app is opened inside the Telegram in-app webview, `telegram-web-app.js`
 * (loaded in index.html) exposes `window.Telegram.WebApp`. We use it to:
 *  - signal the app is ready and request full-height expansion,
 *  - mirror Telegram's theme + safe-area/viewport into CSS variables so the
 *    layout matches the surrounding Telegram UI and respects insets.
 *
 * In a normal browser `window.Telegram` is undefined and this function does
 * nothing, so the same bundle runs everywhere.
 */
export function initTelegram() {
  const tg = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined
  if (!tg) return

  tg.ready()
  tg.expand?.()

  const root = document.documentElement

  // Mirror the viewport height into a CSS var so layouts can size to the
  // actual (possibly reduced) Telegram viewport rather than 100vh.
  const applyViewport = () => {
    if (tg.viewportStableHeight) {
      root.style.setProperty('--tg-viewport-height', `${tg.viewportStableHeight}px`)
    }
  }
  applyViewport()
  tg.onEvent?.('viewportChanged', applyViewport)

  // Mirror Telegram theme colors (fall back gracefully when absent).
  const p = tg.themeParams || {}
  if (p.bg_color) root.style.setProperty('--tg-bg-color', p.bg_color)
  if (p.text_color) root.style.setProperty('--tg-text-color', p.text_color)
}

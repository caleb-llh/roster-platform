/**
 * Copy text to the clipboard, returning true on success.
 *
 * Uses the async Clipboard API when available (HTTPS / localhost), and falls
 * back to a hidden <textarea> + execCommand('copy') otherwise (e.g. insecure
 * origins, older browsers, or when the async write is blocked/rejected).
 *
 * A domain-free leaf: no roster knowledge, just the clipboard boundary.
 */
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the legacy path
  }

  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.top = '-9999px'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}

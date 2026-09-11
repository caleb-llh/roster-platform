import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { initTelegram } from './integrations/telegram'
import { useAuth } from './hooks/useAuth'
import AuthGate from './components/AuthGate'
import DesignSystem from './components/DesignSystem'

initTelegram()

/**
 * Root wrapper: resolves auth once, gates the app behind sign-in in production
 * mode, and passes the auth handle to App (for the sign-out control). In local
 * mode AuthGate is a pass-through, so the playground renders unchanged.
 *
 */
function Root() {
  const auth = useAuth()
  return (
    <AuthGate auth={auth}>
      <App auth={auth} />
    </AuthGate>
  )
}

// The `#design` hash short-circuits to the standalone design-system reference
// page — no router, no auth, no data flow (see DesignSystem.jsx). Decided at
// mount so Root's hooks are never conditionally skipped.
const isDesignSystem =
  typeof window !== 'undefined' && window.location.hash === '#design'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>{isDesignSystem ? <DesignSystem /> : <Root />}</React.StrictMode>,
)

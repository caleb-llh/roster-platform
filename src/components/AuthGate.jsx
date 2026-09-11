/**
 * Auth gate for production mode.
 *
 * - Local mode: renders children immediately (no auth, login-free playground).
 * - Production, still resolving session: a lightweight loading state.
 * - Production, no session: a centered "Sign in with Google" screen.
 * - Production, signed in: renders children.
 *
 * The gate lives outside <App/> so the whole app is only mounted once the user
 * is known, keeping the data provider's assumptions simple.
 */
import { glassModal, headingModal, btnNeutral } from '../design/designSystem'

export default function AuthGate({ auth, children }) {
  const { mode, loading, session, signInWithGoogle } = auth

  if (mode === 'local' || session) {
    return children
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-gray-500">
        Loading…
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className={`w-full max-w-sm p-8 text-center ${glassModal}`}>
        <h1 className={headingModal}>Roster Builder</h1>
        <p className="mt-2 text-sm text-gray-500">Sign in to view and edit your rosters.</p>
        <button
          onClick={signInWithGoogle}
          className={`${btnNeutral} mt-6 flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm shadow-sm active:scale-[0.99] touch-manipulation`}
        >
          <img
            src="https://www.google.com/favicon.ico"
            alt=""
            className="h-4 w-4"
          />
          Continue with Google
        </button>
      </div>
    </div>
  )
}

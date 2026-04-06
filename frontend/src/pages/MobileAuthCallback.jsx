/**
 * Mobile OAuth relay page.
 *
 * Stack Auth (and Google Cloud Console) require HTTPS redirect URIs, so the
 * mobile app registers https://<domain>/auth/callback instead of the custom
 * scheme document-manager://auth/callback.
 *
 * This page acts as a transparent bridge:
 *   1. Stack Auth redirects here with ?code=...&state=...
 *   2. This page immediately redirects the browser to
 *      document-manager://auth/callback?code=...&state=...
 *   3. iOS / Android intercepts that custom-scheme URL and returns it to the
 *      app via WebBrowser.openAuthSessionAsync, which resolves with the URL.
 *   4. The mobile app extracts the code and completes the PKCE token exchange.
 *
 * This page is intentionally unauthenticated and has no side-effects beyond
 * forwarding the URL parameters.
 */
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

const MOBILE_SCHEME = 'document-manager'

export default function MobileAuthCallback() {
  const { search } = useLocation()

  useEffect(() => {
    const deepLink = `${MOBILE_SCHEME}://auth/callback${search}`
    window.location.href = deepLink
  }, [search])

  const deepLink = `${MOBILE_SCHEME}://auth/callback${search}`

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      backgroundColor: '#0F0F0F',
      color: '#888',
      fontFamily: 'Inter, system-ui, sans-serif',
      gap: '16px',
      padding: '24px',
      textAlign: 'center',
    }}>
      <div style={{
        width: '36px',
        height: '36px',
        border: '3px solid #333',
        borderTopColor: '#4A9EFF',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <p style={{ margin: 0, fontSize: '1rem' }}>Redirecting to the app…</p>
      <p style={{ margin: 0, fontSize: '0.875rem', color: '#555' }}>
        If the app doesn&apos;t open automatically,{' '}
        <a href={deepLink} style={{ color: '#4A9EFF' }}>tap here</a>.
      </p>
    </div>
  )
}

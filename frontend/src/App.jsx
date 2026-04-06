import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useEffect, Suspense } from 'react'
import { StackHandler, useUser } from '@stackframe/react'
import { stackApp } from './lib/stack.js'
import Navbar from './components/Navbar'
import ErrorBoundary from './components/ErrorBoundary'
import { ToastContainer } from './components/Notifications'
import { NotificationProvider } from './hooks/useNotifications'
import { ConnectionProvider } from './hooks/useConnectionStatus'
import Home from './pages/Home'
import DocumentView from './pages/DocumentView'
import Browse from './pages/Browse'
import Dashboard from './pages/Dashboard'
import Logs from './pages/Logs'
import ResolveLink from './pages/ResolveLink'
import HowItWorks from './pages/HowItWorks'
import Settings from './pages/settings'
import EntryInspector from './pages/EntryInspector'
import EmbeddingViz from './pages/EmbeddingViz'
import Setup from './pages/Setup'
import MobileAuthCallback from './pages/MobileAuthCallback'

// Full-page loading fallback shown while Stack Auth initializes
function AuthLoadingFallback() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      backgroundColor: 'var(--color-bg, #1a1a1a)',
      color: 'var(--color-text-muted, #888)',
      fontSize: '1rem',
      fontFamily: 'Inter, system-ui, sans-serif'
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: '32px',
          height: '32px',
          border: '3px solid var(--color-border, #333)',
          borderTopColor: 'var(--color-primary, #646cff)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
          margin: '0 auto 16px'
        }} />
        Loading…
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// Component that redirects unauthenticated users to sign-in.
// useUser({ or: 'redirect' }) suspends (via React Suspense) while the
// auth state is loading, so this component must be rendered inside a
// <Suspense> boundary (see App below).
function ProtectedRoute({ children }) {
  const user = useUser({ or: 'redirect' })
  if (!user) return null
  return children
}

// Component that handles first-run detection and redirect.
// Checks once on mount whether first-run setup is required; if so,
// navigates to /setup. Subsequent navigations do not re-trigger the check.
function FirstRunRedirect({ children }) {
  const navigate = useNavigate()

  useEffect(() => {
    const checkFirstRun = async () => {
      try {
        const res = await fetch('/api/system/first-run')
        if (res.ok) {
          const data = await res.json()
          if (data.setup_required) {
            navigate('/setup')
          }
        }
      } catch (err) {
        console.error('Failed to check first-run status:', err)
      }
    }

    checkFirstRun()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])  // run once on mount only

  // Always render children; navigation to /setup happens asynchronously if needed.
  return children
}

function App() {
  return (
    <ErrorBoundary>
      <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ConnectionProvider>
          <NotificationProvider>
            <Suspense fallback={<AuthLoadingFallback />}>
              <FirstRunRedirect>
                <Navbar />
                <div style={{ paddingTop: '60px' }}>
                  <Routes>
                    <Route path="/handler/*" element={<StackHandler app={stackApp} fullPage />} />
                    {/* Public relay – forwards OAuth code to the mobile app's custom scheme */}
                    <Route path="/auth/callback" element={<MobileAuthCallback />} />
                    <Route path="/setup" element={<Setup />} />
                    <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
                    <Route path="/browse" element={<ProtectedRoute><Browse /></ProtectedRoute>} />
                    <Route path="/files" element={<ProtectedRoute><Navigate to="/browse?tab=files" replace /></ProtectedRoute>} />
                    <Route path="/gallery" element={<ProtectedRoute><Navigate to="/browse?tab=images" replace /></ProtectedRoute>} />
                    <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                    <Route path="/logs" element={<ProtectedRoute><Logs /></ProtectedRoute>} />
                    <Route path="/how-it-works" element={<ProtectedRoute><HowItWorks /></ProtectedRoute>} />
                    <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
                    <Route path="/document/:id" element={<ProtectedRoute><DocumentView /></ProtectedRoute>} />
                    <Route path="/resolve" element={<ProtectedRoute><ResolveLink /></ProtectedRoute>} />
                    <Route path="/entry" element={<ProtectedRoute><EntryInspector /></ProtectedRoute>} />
                    <Route path="/entry/:entryId" element={<ProtectedRoute><EntryInspector /></ProtectedRoute>} />
                    <Route path="/embeddings" element={<ProtectedRoute><EmbeddingViz /></ProtectedRoute>} />
                  </Routes>
                </div>
              </FirstRunRedirect>
            </Suspense>
            <ToastContainer />
          </NotificationProvider>
        </ConnectionProvider>
      </Router>
    </ErrorBoundary>
  )
}

export default App

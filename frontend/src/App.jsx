import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
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

// Component that redirects unauthenticated users to sign-in
function ProtectedRoute({ children }) {
  const user = useUser({ or: 'redirect' })
  if (!user) return null
  return children
}

// Component that handles first-run detection and redirect
function FirstRunRedirect({ children }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [checking, setChecking] = useState(true)
  const [setupRequired, setSetupRequired] = useState(false)

  useEffect(() => {
    // Skip check if already on setup page
    if (location.pathname === '/setup') {
      setChecking(false)
      return
    }

    // Check first-run status
    const checkFirstRun = async () => {
      try {
        const res = await fetch('/api/system/first-run')
        if (res.ok) {
          const data = await res.json()
          if (data.setup_required) {
            setSetupRequired(true)
            navigate('/setup')
          }
        }
      } catch (err) {
        console.error('Failed to check first-run status:', err)
      }
      setChecking(false)
    }

    checkFirstRun()
  }, [location.pathname, navigate])

  // Show loading briefly while checking
  if (checking && location.pathname === '/') {
    return null
  }

  return children
}

function App() {
  return (
    <ErrorBoundary>
      <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ConnectionProvider>
          <NotificationProvider>
            <FirstRunRedirect>
              <Navbar />
              <div style={{ paddingTop: '60px' }}>
                <Routes>
                  <Route path="/handler/*" element={<StackHandler app={stackApp} fullPage />} />
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
            <ToastContainer />
          </NotificationProvider>
        </ConnectionProvider>
      </Router>
    </ErrorBoundary>
  )
}

export default App

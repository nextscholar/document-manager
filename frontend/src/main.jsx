import React from 'react'
import ReactDOM from 'react-dom/client'
import { StackProvider, StackTheme } from '@stackframe/react'
import App from './App.jsx'
import { stackApp } from './lib/stack.js'
import './index.css'

// Unregister any stale service workers from previous configurations
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      registration.unregister()
      console.log('Unregistered stale service worker:', registration.scope)
    }
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <StackProvider app={stackApp}>
    <StackTheme>
      <App />
    </StackTheme>
  </StackProvider>
)

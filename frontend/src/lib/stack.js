import { StackClientApp } from '@stackframe/react'

const projectId = import.meta.env.VITE_STACK_PROJECT_ID
const ViteStackApiURL = import.meta.env.VITE_STACK_API_URL
const publishableClientKey = import.meta.env.VITE_STACK_PUBLISHABLE_CLIENT_KEY

if (!projectId || !publishableClientKey) {
  throw new Error(
    'Missing Stack Auth configuration. Set VITE_STACK_PROJECT_ID and VITE_STACK_PUBLISHABLE_CLIENT_KEY in your .env file.'
  )
}

export const stackApp = new StackClientApp({
  projectId,
  publishableClientKey,
  baseUrl: ViteStackApiURL,
  tokenStore: 'cookie',
  urls: {
    signIn: '/handler/sign-in',
    signUp: '/handler/sign-up',
    afterSignIn: '/',
    afterSignUp: '/',
    afterSignOut: '/',
  },
})

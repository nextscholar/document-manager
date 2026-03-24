import { StackClientApp } from '@stackframe/react'

const projectURL = import.meta.env.NEXT_PUBLIC_STACK_API_URL
const projectId = import.meta.env.NEXT_PUBLIC_STACK_PROJECT_ID
const publishableClientKey = import.meta.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY

if (!projectId || !publishableClientKey) {
  throw new Error(
    'Missing Stack Auth configuration. Set STACK_PROJECT_ID and STACK_PUBLISHABLE_CLIENT_KEY in your .env file.'
  )
}

export const stackApp = new StackClientApp({
  projectId,
  projectURL,
  publishableClientKey,
  tokenStore: 'cookie',
  urls: {
    signIn: '/handler/sign-in',
    signUp: '/handler/sign-up',
    afterSignIn: '/',
    afterSignUp: '/',
    afterSignOut: '/',
  },
})

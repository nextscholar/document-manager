/**
 * Stack Auth integration for React Native.
 *
 * Unlike the web frontend (which uses @stackframe/react with cookie storage),
 * this module implements auth against the Stack Auth REST API directly and
 * persists tokens in AsyncStorage.
 *
 * Sign-in / sign-up use the Stack Auth Password credential endpoints:
 *   POST {STACK_AUTH_URL}/api/v1/auth/password/sign-in
 *   POST {STACK_AUTH_URL}/api/v1/auth/password/sign-up
 *
 * OAuth (Google) uses the Stack Auth OAuth authorize flow with PKCE:
 *   GET  {STACK_AUTH_URL}/api/v1/auth/oauth/authorize/{provider_id}
 *   POST {STACK_AUTH_URL}/api/v1/auth/oauth/token
 *
 * The resulting access_token is forwarded as the `x-stack-access-token`
 * header on every API request to the backend (same header the web app uses).
 */
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ExpoCrypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

// ---------------------------------------------------------------------------
// Config (from Expo public env vars)
// ---------------------------------------------------------------------------

const STACK_PROJECT_ID = process.env.EXPO_PUBLIC_STACK_PROJECT_ID ?? '';
const STACK_PUBLISHABLE_CLIENT_KEY =
  process.env.EXPO_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY ?? '';
const STACK_AUTH_URL =
  process.env.EXPO_PUBLIC_STACK_AUTH_URL ?? 'https://api.stack-auth.com';

// ---------------------------------------------------------------------------
// AsyncStorage keys
// ---------------------------------------------------------------------------

const STORAGE_KEYS = {
  ACCESS_TOKEN: '@dm:access_token',
  REFRESH_TOKEN: '@dm:refresh_token',
  USER_ID: '@dm:user_id',
  USER_EMAIL: '@dm:user_email',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string;
  email: string;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  signInWithOAuth: () => Promise<void>;
  signOut: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// PKCE helpers (uses expo-crypto for React Native compatibility)
// ---------------------------------------------------------------------------

/** Base64url-encode a Uint8Array (no padding). */
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** Generate a PKCE code_verifier (32 random bytes, base64url-encoded → ~43 chars). */
function generateCodeVerifier(): string {
  const bytes = ExpoCrypto.getRandomBytes(32);
  return base64UrlEncode(bytes);
}

/** Derive the PKCE code_challenge (SHA-256 of verifier, base64url-encoded). */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const base64 = await ExpoCrypto.digestStringAsync(
    ExpoCrypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: ExpoCrypto.CryptoEncoding.BASE64 },
  );
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** Generate a random OAuth state string. */
function generateState(): string {
  const bytes = ExpoCrypto.getRandomBytes(16);
  return base64UrlEncode(bytes);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Common request headers sent to Stack Auth endpoints. */
function stackAuthHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-stack-project-id': STACK_PROJECT_ID,
    'x-stack-publishable-client-key': STACK_PUBLISHABLE_CLIENT_KEY,
    'x-stack-access-type': 'client',
  };
}

/**
 * Persist access/refresh tokens to AsyncStorage.
 */
async function persistTokens(
  data: Record<string, unknown>,
): Promise<{ accessToken: string }> {
  const accessToken = data['access_token'] as string;
  const refreshToken = (data['refresh_token'] as string | undefined) ?? '';

  await AsyncStorage.multiSet([
    [STORAGE_KEYS.ACCESS_TOKEN, accessToken],
    [STORAGE_KEYS.REFRESH_TOKEN, refreshToken],
  ]);

  return { accessToken };
}

/**
 * Fetch the authenticated user's profile from Stack Auth and persist it.
 * Password sign-in/sign-up responses only include `user_id` (no email).
 * OAuth token-exchange responses include neither user_id nor email.
 * Fetching /users/me with the access token gives us both fields reliably.
 */
async function fetchAndPersistUser(accessToken: string): Promise<AuthUser> {
  try {
    const res = await fetch(`${STACK_AUTH_URL}/api/v1/users/me`, {
      headers: {
        ...stackAuthHeaders(),
        'x-stack-access-token': accessToken,
      },
    });
    if (res.ok) {
      const data = await res.json() as Record<string, unknown>;
      const id = (data['id'] as string | undefined) ?? '';
      const email = (data['primary_email'] as string | undefined) ?? '';
      await AsyncStorage.multiSet([
        [STORAGE_KEYS.USER_ID, id],
        [STORAGE_KEYS.USER_EMAIL, email],
      ]);
      return { id, email };
    }
  } catch {
    // Fall through to empty user on network errors
  }
  return { id: '', email: '' };
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    loading: true,
  });

  // Restore persisted session on mount
  useEffect(() => {
    (async () => {
      try {
        const [[, accessToken], [, userId], [, userEmail]] =
          await AsyncStorage.multiGet([
            STORAGE_KEYS.ACCESS_TOKEN,
            STORAGE_KEYS.USER_ID,
            STORAGE_KEYS.USER_EMAIL,
          ]);

        if (accessToken && userId) {
          setState({
            user: { id: userId, email: userEmail ?? '' },
            accessToken,
            loading: false,
          });
          return;
        }
      } catch {
        // Ignore storage errors on startup
      }
      setState({ user: null, accessToken: null, loading: false });
    })();
  }, []);

  // -------------------------------------------------------------------------
  // Sign in (email + password)
  // -------------------------------------------------------------------------
  const signIn = useCallback(async (email: string, password: string) => {
    const res = await fetch(`${STACK_AUTH_URL}/api/v1/auth/password/sign-in`, {
      method: 'POST',
      headers: stackAuthHeaders(),
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        (body as Record<string, string>)['message'] ?? `Sign-in failed (${res.status})`,
      );
    }

    const data = await res.json();
    const { accessToken } = await persistTokens(data);
    const user = await fetchAndPersistUser(accessToken);
    setState({ user, accessToken, loading: false });
  }, []);

  // -------------------------------------------------------------------------
  // Sign up (email + password)
  // -------------------------------------------------------------------------
  const signUp = useCallback(
    async (email: string, password: string, _displayName?: string) => {
      // The Stack Auth password sign-up endpoint only accepts `email` and
      // `password`. The `display_name` field is not supported here and causes
      // a 400 error when included.
      const res = await fetch(`${STACK_AUTH_URL}/api/v1/auth/password/sign-up`, {
        method: 'POST',
        headers: stackAuthHeaders(),
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as Record<string, string>)['message'] ?? `Sign-up failed (${res.status})`,
        );
      }

      const data = await res.json();
      const { accessToken } = await persistTokens(data);
      const user = await fetchAndPersistUser(accessToken);
      setState({ user, accessToken, loading: false });
    },
    [],
  );

  // -------------------------------------------------------------------------
  // OAuth sign-in via expo-web-browser (opens the Stack Auth hosted page)
  //
  // The correct Stack Auth OAuth authorize URL uses the provider as a PATH
  // parameter: /api/v1/auth/oauth/authorize/{provider_id}
  // Required query params mirror the OAuth 2.0 + PKCE spec:
  //   client_id, client_secret, redirect_uri, scope, state, grant_type,
  //   code_challenge, code_challenge_method, response_type, type
  // -------------------------------------------------------------------------
  const signInWithOAuth = useCallback(async () => {
    const redirectUri = Linking.createURL('auth/callback');

    // PKCE – required for mobile OAuth flows
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateState();

    const params = new URLSearchParams({
      client_id: STACK_PROJECT_ID,
      client_secret: STACK_PUBLISHABLE_CLIENT_KEY,
      redirect_uri: redirectUri,
      scope: 'legacy',
      state,
      grant_type: 'authorization_code',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      response_type: 'code',
      type: 'authenticate',
    });

    // provider_id is a PATH parameter, not a query parameter
    const authUrl = `${STACK_AUTH_URL}/api/v1/auth/oauth/authorize/google?${params.toString()}`;

    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      WebBrowser.warmUpAsync();
    }

    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);

    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      WebBrowser.coolDownAsync();
    }

    if (result.type !== 'success') return;

    // Extract the authorization code from the callback URL
    const parsed = Linking.parse(result.url);
    const code = (parsed.queryParams as Record<string, string> | undefined)?.['code'];
    if (!code) throw new Error('OAuth callback did not include a code');

    // Exchange authorization code for tokens (OAuth 2.0 spec)
    const tokenRes = await fetch(`${STACK_AUTH_URL}/api/v1/auth/oauth/token`, {
      method: 'POST',
      headers: stackAuthHeaders(),
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
        client_id: STACK_PROJECT_ID,
        client_secret: STACK_PUBLISHABLE_CLIENT_KEY,
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.json().catch(() => ({}));
      throw new Error(
        (body as Record<string, string>)['message'] ?? `OAuth token exchange failed (${tokenRes.status})`,
      );
    }

    const data = await tokenRes.json();
    const { accessToken } = await persistTokens(data);
    // OAuth token exchange response does not include user info – fetch it
    const user = await fetchAndPersistUser(accessToken);
    setState({ user, accessToken, loading: false });
  }, []);

  // -------------------------------------------------------------------------
  // Sign out
  // -------------------------------------------------------------------------
  const signOut = useCallback(async () => {
    await AsyncStorage.multiRemove([
      STORAGE_KEYS.ACCESS_TOKEN,
      STORAGE_KEYS.REFRESH_TOKEN,
      STORAGE_KEYS.USER_ID,
      STORAGE_KEYS.USER_EMAIL,
    ]);
    setState({ user: null, accessToken: null, loading: false });
  }, []);

  return (
    <AuthContext.Provider
      value={{ ...state, signIn, signUp, signInWithOAuth, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}

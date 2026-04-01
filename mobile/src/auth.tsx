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
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import { AuthTokens } from './types';

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
 * Exchange access/refresh tokens from a raw Stack Auth API response and
 * persist them to AsyncStorage.  Also persists user id + email.
 */
async function persistTokens(
  data: Record<string, unknown>,
): Promise<{ user: AuthUser; accessToken: string }> {
  const accessToken = data['access_token'] as string;
  const refreshToken = data['refresh_token'] as string;
  const userId =
    (data['user_id'] as string | undefined) ??
    ((data['user'] as Record<string, unknown> | undefined)?.['id'] as string | undefined) ??
    '';
  const userEmail =
    ((data['user'] as Record<string, unknown> | undefined)?.['primary_email'] as string | undefined) ?? '';

  await AsyncStorage.multiSet([
    [STORAGE_KEYS.ACCESS_TOKEN, accessToken],
    [STORAGE_KEYS.REFRESH_TOKEN, refreshToken ?? ''],
    [STORAGE_KEYS.USER_ID, userId],
    [STORAGE_KEYS.USER_EMAIL, userEmail],
  ]);

  return { user: { id: userId, email: userEmail }, accessToken };
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
    const { user, accessToken } = await persistTokens(data);
    setState({ user, accessToken, loading: false });
  }, []);

  // -------------------------------------------------------------------------
  // Sign up (email + password)
  // -------------------------------------------------------------------------
  const signUp = useCallback(
    async (email: string, password: string, displayName?: string) => {
      const res = await fetch(`${STACK_AUTH_URL}/api/v1/auth/password/sign-up`, {
        method: 'POST',
        headers: stackAuthHeaders(),
        body: JSON.stringify({ email, password, display_name: displayName ?? email }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as Record<string, string>)['message'] ?? `Sign-up failed (${res.status})`,
        );
      }

      const data = await res.json();
      const { user, accessToken } = await persistTokens(data);
      setState({ user, accessToken, loading: false });
    },
    [],
  );

  // -------------------------------------------------------------------------
  // OAuth sign-in via expo-web-browser (opens the Stack Auth hosted page)
  // -------------------------------------------------------------------------
  const signInWithOAuth = useCallback(async () => {
    const redirectUri = Linking.createURL('auth/callback');
    const authUrl =
      `${STACK_AUTH_URL}/api/v1/auth/oauth/authorize` +
      `?provider_id=google` +
      `&type=authenticate` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&project_id=${encodeURIComponent(STACK_PROJECT_ID)}`;

    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      WebBrowser.warmUpAsync();
    }

    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);

    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      WebBrowser.coolDownAsync();
    }

    if (result.type !== 'success') return;

    // Extract the token from the callback URL
    const parsed = Linking.parse(result.url);
    const code = (parsed.queryParams as Record<string, string> | undefined)?.['code'];
    if (!code) throw new Error('OAuth callback did not include a code');

    // Exchange code for tokens
    const tokenRes = await fetch(`${STACK_AUTH_URL}/api/v1/auth/oauth/token`, {
      method: 'POST',
      headers: stackAuthHeaders(),
      body: JSON.stringify({ code, redirect_uri: redirectUri }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.json().catch(() => ({}));
      throw new Error(
        (body as Record<string, string>)['message'] ?? `OAuth token exchange failed (${tokenRes.status})`,
      );
    }

    const data = await tokenRes.json();
    const { user, accessToken } = await persistTokens(data);
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

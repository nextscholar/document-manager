/**
 * Unit tests for mobile/src/auth.tsx
 *
 * Tests cover:
 *  - signIn: success and 400 error (with Stack Auth "error" field surfaced)
 *  - signUp: success and 400 error (same)
 *  - signOut: clears stored tokens
 *  - Session restoration on mount (AuthProvider)
 *  - fetchAndPersistUser called after sign-in / sign-up
 *
 * All network calls and native modules are mocked so no real HTTP traffic
 * is made and no React Native runtime is needed.
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ---------------------------------------------------------------------------
// Module-level mocks (must appear before imports that use them)
// ---------------------------------------------------------------------------

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-linking', () => ({
  createURL: jest.fn((path: string) => `document-manager://${path}`),
  parse: jest.fn((url: string) => ({
    queryParams: Object.fromEntries(new URL(url).searchParams.entries()),
  })),
}));

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(),
  warmUpAsync: jest.fn(),
  coolDownAsync: jest.fn(),
}));

// expo-crypto is mapped to __mocks__/expo-crypto.ts via moduleNameMapper

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { AuthProvider, useAuth } from '../auth';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal fetch mock that returns a JSON body. */
function mockFetch(status: number, body: Record<string, unknown>) {
  return jest.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValueOnce(body),
  });
}

/**
 * Creates a sequence of fetch mocks in order.
 * The first call returns mocks[0], second call returns mocks[1], etc.
 */
function mockFetchSequence(
  ...mocks: Array<{ status: number; body: Record<string, unknown> }>
) {
  const fn = jest.fn();
  for (const { status, body } of mocks) {
    fn.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      json: jest.fn().mockResolvedValueOnce(body),
    });
  }
  return fn;
}

const SIGN_IN_RESPONSE = {
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  user_id: 'usr_123',
};

const ME_RESPONSE = {
  id: 'usr_123',
  primary_email: 'test@example.com',
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('auth module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage as jest.Mocked<typeof AsyncStorage>).clear();
  });

  // -------------------------------------------------------------------------
  // signIn
  // -------------------------------------------------------------------------

  describe('signIn', () => {
    it('signs in successfully and stores tokens', async () => {
      global.fetch = mockFetchSequence(
        { status: 200, body: SIGN_IN_RESPONSE },
        { status: 200, body: ME_RESPONSE },
      );

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AuthProvider>{children}</AuthProvider>
      );
      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.signIn('test@example.com', 'password123');
      });

      expect(result.current.user).toEqual({
        id: 'usr_123',
        email: 'test@example.com',
      });
      expect(result.current.accessToken).toBe('test-access-token');

      const tokenPairs = await AsyncStorage.multiGet(['@dm:access_token']);
      const storedToken = tokenPairs[0][1];
      expect(storedToken).toBe('test-access-token');
    });

    it('throws with the server error message on 400', async () => {
      global.fetch = mockFetch(400, {
        code: 'WRONG_PASSWORD',
        error: 'Incorrect email or password.',
      });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AuthProvider>{children}</AuthProvider>
      );
      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));

      await expect(
        act(async () => {
          await result.current.signIn('test@example.com', 'wrongpassword');
        }),
      ).rejects.toThrow('Incorrect email or password.');
    });

    it('falls back to generic message when no error field returned', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: jest.fn().mockRejectedValueOnce(new Error('not json')),
      });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AuthProvider>{children}</AuthProvider>
      );
      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));

      await expect(
        act(async () => {
          await result.current.signIn('test@example.com', 'password');
        }),
      ).rejects.toThrow('Sign-in failed (400)');
    });
  });

  // -------------------------------------------------------------------------
  // signUp
  // -------------------------------------------------------------------------

  describe('signUp', () => {
    it('creates an account successfully and stores tokens', async () => {
      global.fetch = mockFetchSequence(
        { status: 200, body: SIGN_IN_RESPONSE },
        { status: 200, body: ME_RESPONSE },
      );

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AuthProvider>{children}</AuthProvider>
      );
      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.signUp('test@example.com', 'password123');
      });

      expect(result.current.user).toEqual({
        id: 'usr_123',
        email: 'test@example.com',
      });
      expect(result.current.accessToken).toBe('test-access-token');
    });

    it('sends only email and password (no display_name)', async () => {
      global.fetch = mockFetchSequence(
        { status: 200, body: SIGN_IN_RESPONSE },
        { status: 200, body: ME_RESPONSE },
      );

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AuthProvider>{children}</AuthProvider>
      );
      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.signUp('test@example.com', 'password123', 'John Doe');
      });

      // The first fetch call is to the sign-up endpoint
      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      const bodyParsed = JSON.parse(fetchCall[1].body as string);
      expect(bodyParsed).toEqual({ email: 'test@example.com', password: 'password123' });
      expect(bodyParsed).not.toHaveProperty('display_name');
    });

    it('surfaces the Stack Auth "error" field on a 400 response', async () => {
      global.fetch = mockFetch(400, {
        code: 'PASSWORD_TOO_SHORT',
        error: 'Password too short. Minimum length is 8.',
        details: { min_length: 8 },
      });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AuthProvider>{children}</AuthProvider>
      );
      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));

      await expect(
        act(async () => {
          await result.current.signUp('test@example.com', 'short');
        }),
      ).rejects.toThrow('Password too short. Minimum length is 8.');
    });

    it('surfaces the Stack Auth "error" field when email is already registered', async () => {
      global.fetch = mockFetch(400, {
        code: 'USER_WITH_EMAIL_ALREADY_EXISTS',
        error: 'User with this email already exists.',
      });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AuthProvider>{children}</AuthProvider>
      );
      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));

      await expect(
        act(async () => {
          await result.current.signUp('existing@example.com', 'password123');
        }),
      ).rejects.toThrow('User with this email already exists.');
    });

    it('falls back to generic message when error body is not JSON', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: jest.fn().mockRejectedValueOnce(new Error('not json')),
      });

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AuthProvider>{children}</AuthProvider>
      );
      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));

      await expect(
        act(async () => {
          await result.current.signUp('test@example.com', 'password123');
        }),
      ).rejects.toThrow('Sign-up failed (400)');
    });
  });

  // -------------------------------------------------------------------------
  // signOut
  // -------------------------------------------------------------------------

  describe('signOut', () => {
    it('clears the user and stored tokens', async () => {
      // Pre-populate storage as if the user were signed in
      await AsyncStorage.multiSet([
        ['@dm:access_token', 'old-token'],
        ['@dm:refresh_token', 'old-refresh'],
        ['@dm:user_id', 'usr_123'],
        ['@dm:user_email', 'test@example.com'],
      ]);

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AuthProvider>{children}</AuthProvider>
      );
      const { result } = renderHook(() => useAuth(), { wrapper });

      // Wait for the provider to restore the session from storage
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.user).not.toBeNull();

      await act(async () => {
        await result.current.signOut();
      });

      expect(result.current.user).toBeNull();
      expect(result.current.accessToken).toBeNull();

      const tokenPairs = await AsyncStorage.multiGet(['@dm:access_token']);
      const token = tokenPairs[0][1];
      expect(token).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Session restoration
  // -------------------------------------------------------------------------

  describe('session restoration', () => {
    it('restores user from AsyncStorage on mount', async () => {
      await AsyncStorage.multiSet([
        ['@dm:access_token', 'restored-token'],
        ['@dm:refresh_token', 'restored-refresh'],
        ['@dm:user_id', 'usr_restored'],
        ['@dm:user_email', 'restored@example.com'],
      ]);

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AuthProvider>{children}</AuthProvider>
      );
      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.user).toEqual({
        id: 'usr_restored',
        email: 'restored@example.com',
      });
      expect(result.current.accessToken).toBe('restored-token');
    });

    it('starts with null user when storage is empty', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <AuthProvider>{children}</AuthProvider>
      );
      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.user).toBeNull();
      expect(result.current.accessToken).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // useAuth outside provider
  // -------------------------------------------------------------------------

  it('throws when useAuth is used outside AuthProvider', () => {
    // Suppress expected React error output
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useAuth())).toThrow(
      'useAuth must be used within <AuthProvider>',
    );
    consoleSpy.mockRestore();
  });
});

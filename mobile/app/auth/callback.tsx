/**
 * OAuth callback screen.
 *
 * Stack Auth (or Google OAuth) redirects to `document-manager://auth/callback`
 * after the user signs in via the system browser.  expo-router renders this
 * screen when that deep link fires; the actual token exchange is handled by
 * the `signInWithOAuth` function in `src/auth.tsx` (using
 * `WebBrowser.openAuthSessionAsync`, which intercepts the redirect before the
 * URL ever reaches this screen on iOS/Android).
 *
 * On web – or as a fallback – this screen is shown briefly while the
 * exchange completes.
 */
import { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

export default function AuthCallbackScreen() {
  const router = useRouter();

  useEffect(() => {
    // The expo-web-browser openAuthSessionAsync call intercepts the redirect
    // on native platforms and resolves the promise in auth.tsx.
    // If we somehow land here (e.g., on web), redirect to sign-in after a
    // short delay so the user isn't stuck.
    const timer = setTimeout(() => {
      router.replace('/sign-in');
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#4A9EFF" />
      <Text style={styles.text}>Completing sign-in…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F0F',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  text: { color: '#888', fontSize: 15 },
});

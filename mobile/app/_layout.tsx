/**
 * Root layout for the Document Manager mobile app.
 *
 * Wraps all routes with the AuthProvider so every screen can access
 * the current auth state.  The <Slot> component renders the active child
 * route; Expo Router handles the navigation stack automatically.
 */
import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';
import { AuthProvider, useAuth } from '../src/auth';

// ---------------------------------------------------------------------------
// Route guard – redirect unauthenticated users to the sign-in screen
// ---------------------------------------------------------------------------

function RouteGuard() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === 'sign-in' || segments[0] === 'sign-up';

    if (!user && !inAuthGroup) {
      // Not signed in → send to sign-in
      router.replace('/sign-in');
    } else if (user && inAuthGroup) {
      // Already signed in → send to home tabs
      router.replace('/(tabs)');
    }
  }, [user, loading, segments]);

  return null;
}

// ---------------------------------------------------------------------------
// Root layout component
// ---------------------------------------------------------------------------

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <AuthProvider>
        <RouteGuard />
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: '#0F0F0F' },
            headerTintColor: '#E8E8E8',
            headerTitleStyle: { fontWeight: '600' },
            contentStyle: { backgroundColor: '#0F0F0F' },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="sign-in" options={{ title: 'Sign In', headerShown: false }} />
          <Stack.Screen name="sign-up" options={{ title: 'Create Account', headerShown: false }} />
          <Stack.Screen
            name="document/[id]"
            options={{ title: 'Document', headerBackTitle: 'Back' }}
          />
        </Stack>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});

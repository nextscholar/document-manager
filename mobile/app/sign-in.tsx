/**
 * Sign-in screen.
 *
 * Supports email + password sign-in and a "Sign in with Google" button
 * that opens the Stack Auth OAuth flow via expo-web-browser.
 */
import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import { Link } from 'expo-router';
import { useAuth } from '../src/auth';

export default function SignInScreen() {
  const { signIn, signInWithOAuth, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);

  async function handleSignIn() {
    if (!email.trim() || !password) {
      Alert.alert('Validation', 'Please enter your email and password.');
      return;
    }
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
    } catch (err: unknown) {
      Alert.alert('Sign-in failed', (err as Error).message ?? 'Unknown error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOAuth() {
    setOauthLoading(true);
    try {
      await signInWithOAuth();
    } catch (err: unknown) {
      Alert.alert('OAuth failed', (err as Error).message ?? 'Unknown error');
    } finally {
      setOauthLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo / title */}
        <View style={styles.header}>
          <Text style={styles.logo}>📁</Text>
          <Text style={styles.title}>Document Manager</Text>
          <Text style={styles.subtitle}>Sign in to your account</Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor="#555"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor="#555"
            secureTextEntry
            textContentType="password"
            onSubmitEditing={handleSignIn}
          />

          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary, (submitting || loading) && styles.btnDisabled]}
            onPress={handleSignIn}
            disabled={submitting || loading}
          >
            {submitting ? (
              <ActivityIndicator color="#0F0F0F" />
            ) : (
              <Text style={styles.btnPrimaryText}>Sign In</Text>
            )}
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity
            style={[styles.btn, styles.btnSecondary, oauthLoading && styles.btnDisabled]}
            onPress={handleOAuth}
            disabled={oauthLoading}
          >
            {oauthLoading ? (
              <ActivityIndicator color="#E8E8E8" />
            ) : (
              <Text style={styles.btnSecondaryText}>Sign in with Google</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Don't have an account? </Text>
          <Link href="/sign-up" asChild>
            <TouchableOpacity>
              <Text style={styles.link}>Create one</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#0F0F0F' },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 48,
  },
  header: { alignItems: 'center', marginBottom: 40 },
  logo: { fontSize: 56, marginBottom: 12 },
  title: { fontSize: 26, fontWeight: '700', color: '#E8E8E8', letterSpacing: 0.3 },
  subtitle: { fontSize: 14, color: '#888', marginTop: 4 },

  form: { gap: 8 },
  label: { color: '#AAA', fontSize: 13, fontWeight: '600', marginBottom: 4, marginTop: 12 },
  input: {
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
    color: '#E8E8E8',
    fontSize: 15,
  },

  btn: {
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 20,
  },
  btnPrimary: { backgroundColor: '#4A9EFF' },
  btnPrimaryText: { color: '#0F0F0F', fontWeight: '700', fontSize: 16 },
  btnSecondary: { backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#333' },
  btnSecondaryText: { color: '#E8E8E8', fontWeight: '600', fontSize: 15 },
  btnDisabled: { opacity: 0.5 },

  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
    gap: 10,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#333' },
  dividerText: { color: '#555', fontSize: 13 },

  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 32 },
  footerText: { color: '#888', fontSize: 14 },
  link: { color: '#4A9EFF', fontSize: 14, fontWeight: '600' },
});

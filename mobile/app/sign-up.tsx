/**
 * Sign-up / create account screen.
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

export default function SignUpScreen() {
  const { signUp } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSignUp() {
    if (!email.trim() || !password) {
      Alert.alert('Validation', 'Please enter your email and a password.');
      return;
    }
    if (password !== confirm) {
      Alert.alert('Validation', 'Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      Alert.alert('Validation', 'Password must be at least 8 characters.');
      return;
    }
    setSubmitting(true);
    try {
      await signUp(email.trim(), password, name.trim() || undefined);
    } catch (err: unknown) {
      Alert.alert('Sign-up failed', (err as Error).message ?? 'Unknown error');
    } finally {
      setSubmitting(false);
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
        <View style={styles.header}>
          <Text style={styles.logo}>📁</Text>
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>Join Document Manager</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>Name (optional)</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor="#555"
            textContentType="name"
          />

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
            placeholder="At least 8 characters"
            placeholderTextColor="#555"
            secureTextEntry
            textContentType="newPassword"
          />

          <Text style={styles.label}>Confirm Password</Text>
          <TextInput
            style={styles.input}
            value={confirm}
            onChangeText={setConfirm}
            placeholder="Re-enter password"
            placeholderTextColor="#555"
            secureTextEntry
            textContentType="newPassword"
            onSubmitEditing={handleSignUp}
          />

          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary, submitting && styles.btnDisabled]}
            onPress={handleSignUp}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#0F0F0F" />
            ) : (
              <Text style={styles.btnPrimaryText}>Create Account</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have an account? </Text>
          <Link href="/sign-in" asChild>
            <TouchableOpacity>
              <Text style={styles.link}>Sign in</Text>
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
  btnDisabled: { opacity: 0.5 },

  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 32 },
  footerText: { color: '#888', fontSize: 14 },
  link: { color: '#4A9EFF', fontSize: 14, fontWeight: '600' },
});

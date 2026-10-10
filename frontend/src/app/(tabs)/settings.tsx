import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
} from 'react-native';

import { useAuth } from '@/contexts/auth-context';
import { supabase } from '@/lib/supabase';

export default function SettingsScreen() {
  const { session } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);

  async function handleSignOut() {
    if (pending.current) return;

    pending.current = true;
    setBusy(true);
    setError('');

    try {
      const { error: signOutError } = await supabase.auth.signOut({
        scope: 'local',
      });

      if (signOutError) {
        setError('Unable to sign out. Please try again.');
      }
    } catch {
      setError('Check your connection and try again.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Radius & Location Settings</Text>
      <Text style={styles.note}>
        Radius and location controls are not connected yet.
      </Text>

      <Text style={styles.label}>Signed in as</Text>
      <Text selectable style={styles.email}>
        {session?.user.email}
      </Text>

      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sign out"
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={() => void handleSignOut()}
        style={({ pressed }) => [
          styles.button,
          (pressed || busy) && styles.dimmed,
        ]}>
        {busy ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.buttonText}>Sign out</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    backgroundColor: '#F3F4F6',
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  note: {
    marginTop: 12,
    fontSize: 15,
    lineHeight: 22,
    color: '#4B5563',
  },
  label: {
    marginTop: 32,
    fontSize: 14,
    color: '#4B5563',
  },
  email: {
    marginTop: 8,
    fontSize: 17,
    color: '#1F2937',
  },
  error: {
    marginTop: 20,
    color: '#B42318',
  },
  button: {
    marginTop: 24,
    minHeight: 52,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#123D36',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  dimmed: {
    opacity: 0.7,
  },
});
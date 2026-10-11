import { useRef, useState } from 'react';
import { Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { AuthButton, AuthShell, s } from '@/components/auth-ui';
import { useAuth } from '@/contexts/auth-context';
import { supabase } from '@/lib/supabase';

export default function SignInScreen() {
  const { error: sessionError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [focus, setFocus] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const passwordInput = useRef<TextInput>(null);

  async function signIn() {
    if (pending.current) return;
    setError('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Enter a valid email address.'); return; }
    if (!password) { setError('Enter your password.'); passwordInput.current?.focus(); return; }
    pending.current = true;
    setBusy(true);
    Keyboard.dismiss();
    try {
      const { error: failure } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (failure) {
        if (failure.code === 'invalid_credentials') setError('The email or password is incorrect. Please try again.');
        else if (failure.code === 'email_not_confirmed') setError('Confirm your email before signing in.');
        else if (failure.status === 429) setError('Too many attempts. Please wait a moment and try again.');
        else setError('Unable to sign in. Check your connection and try again.');
      }
    } catch { setError('Unable to connect. Check your internet connection and try again.'); }
    finally { pending.current = false; setBusy(false); }
  }

  return <AuthShell>
    <View><Text style={s.eyebrow}>YOUR CAREGIVER SPACE</Text><Text accessibilityRole="header" style={s.title}>Care starts{ '\n' }with connection.</Text><Text style={s.subtitle}>Welcome back. Sign in to your careQ account.</Text></View>
    <View style={s.panel}>
      <View><Text style={s.label}>Email address</Text><TextInput accessibilityLabel="Email address" style={[s.input, focus === 'email' && s.focused]} value={email} onChangeText={setEmail} editable={!busy} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" placeholder="you@example.com" placeholderTextColor="#9BB4A9" returnKeyType="next" onSubmitEditing={() => passwordInput.current?.focus()} onFocus={() => setFocus('email')} onBlur={() => setFocus('')} /></View>
      <View><Text style={s.label}>Password</Text><View style={s.passwordRow}><TextInput ref={passwordInput} accessibilityLabel="Password" style={[s.input, { flex: 1 }, focus === 'password' && s.focused]} value={password} onChangeText={setPassword} editable={!busy} secureTextEntry={!visible} autoCapitalize="none" autoCorrect={false} autoComplete="current-password" placeholder="Your password" placeholderTextColor="#9BB4A9" returnKeyType="go" onSubmitEditing={() => void signIn()} onFocus={() => setFocus('password')} onBlur={() => setFocus('')} /><Pressable accessibilityRole="button" accessibilityLabel={visible ? 'Hide password' : 'Show password'} onPress={() => setVisible(!visible)} style={s.reveal}><Text style={s.link}>{visible ? 'Hide' : 'Show'}</Text></Pressable></View></View>
      {!!(error || sessionError) && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{error || sessionError}</Text>}
      <AuthButton label={busy ? 'Signing in…' : 'Sign in  →'} busy={busy} onPress={() => void signIn()} />
    </View>
    <Pressable accessibilityRole="button" onPress={() => router.push('/(auth)/register')}>
      <Text style={s.note}>Don't have an account? <Text style={s.link}>Create caregiver account →</Text></Text>
    </Pressable>
  </AuthShell>;
}

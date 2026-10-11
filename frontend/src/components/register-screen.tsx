import { useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { AuthButton, AuthShell, s } from '@/components/auth-ui';
import { supabase } from '@/lib/supabase';

// Password security criteria checker
function getPasswordMetrics(password: string) {
  return {
    minLength: password.length >= 8,
    hasLower: /[a-z]/.test(password),
    hasUpper: /[A-Z]/.test(password),
    hasNumber: /[0-9]/.test(password),
    hasSymbol: /[^a-zA-Z0-9]/.test(password),
  };
}

export default function RegisterScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [focus, setFocus] = useState('');
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // State indicating email verification message view
  const [verificationSent, setVerificationSent] = useState(false);

  const pending = useRef(false);
  const passwordInput = useRef<TextInput>(null);
  const confirmPasswordInput = useRef<TextInput>(null);

  const passwordMetrics = getPasswordMetrics(password);
  const isPasswordValid =
    passwordMetrics.minLength &&
    passwordMetrics.hasLower &&
    passwordMetrics.hasUpper &&
    passwordMetrics.hasNumber &&
    passwordMetrics.hasSymbol;

  async function handleRegister() {
    if (pending.current) return;
    setError('');
    setNotice('');

    const trimmedEmail = email.trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    if (!isPasswordValid) {
      setError('Password does not meet all security requirements listed below.');
      passwordInput.current?.focus();
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match. Please re-enter.');
      confirmPasswordInput.current?.focus();
      return;
    }

    pending.current = true;
    setBusy(true);
    Keyboard.dismiss();

    try {
      // Register user account in Supabase Auth (auth.users)
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: trimmedEmail,
        password: password,
      });

      if (signUpError) {
        if (signUpError.message.includes('already registered')) {
          setError('An account with this email already exists. Try logging in.');
        } else if (signUpError.status === 429 || signUpError.message.includes('rate limit')) {
          setError('Supabase email rate limit reached (max 3/hour on free tier). Please wait a few minutes and try again.');
        } else {
          setError(signUpError.message || 'Unable to create account. Please try again.');
        }
      } else if (data.user) {
        if (data.session) {
          // Auto-confirmed / Session active
          setNotice('Account created successfully! Redirecting...');
        } else {
          // Email verification required
          setVerificationSent(true);
        }
      }
    } catch {
      setError('Unable to connect to server. Check your internet connection.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function handleResendVerification() {
    if (resending || !email.trim()) return;
    setResending(true);
    setError('');
    setNotice('');

    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
      });

      if (resendError) {
        if (resendError.status === 429) {
          setError('Please wait a minute before requesting another verification email.');
        } else {
          setError(resendError.message || 'Could not resend verification email.');
        }
      } else {
        setNotice('A new verification link has been sent to your email.');
      }
    } catch {
      setError('Failed to resend verification email. Check network connection.');
    } finally {
      setResending(false);
    }
  }

  // View: Email Verification Sent
  if (verificationSent) {
    return (
      <AuthShell>
        <View>
          <Text style={s.eyebrow}>EMAIL VERIFICATION REQUIRED</Text>
          <Text accessibilityRole="header" style={s.title}>
            Check your{'\n'}inbox.
          </Text>
          <Text style={s.subtitle}>
            We sent a verification link to <Text style={styles.highlightEmail}>{email.trim()}</Text>.
          </Text>
        </View>

        <View style={s.panel}>
          <Text style={s.note}>
            Please click the link in your email to verify your account and complete registration before signing in.
          </Text>

          {!!error && (
            <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>
              {error}
            </Text>
          )}

          {!!notice && (
            <Text accessibilityLiveRegion="polite" style={styles.successNotice}>
              {notice}
            </Text>
          )}

          <AuthButton
            label={resending ? 'Resending email…' : 'Resend Verification Email'}
            busy={resending}
            onPress={() => void handleResendVerification()}
          />
        </View>

        <Pressable accessibilityRole="button" onPress={() => router.push('/(auth)/login')}>
          <Text style={s.note}>
            Verified your email? <Text style={s.link}>Return to Sign In →</Text>
          </Text>
        </Pressable>
      </AuthShell>
    );
  }

  // View: Main Registration Form
  return (
    <AuthShell>
      <View>
        <Text style={s.eyebrow}>JOIN CAREGIVER NETWORK</Text>
        <Text accessibilityRole="header" style={s.title}>
          Create your{'\n'}account.
        </Text>
        <Text style={s.subtitle}>Register as a caregiver to start monitoring patient safety.</Text>
      </View>

      <View style={s.panel}>
        {/* Email Address */}
        <View>
          <Text style={s.label}>Email address</Text>
          <TextInput
            accessibilityLabel="Email address"
            style={[s.input, focus === 'email' && s.focused]}
            value={email}
            onChangeText={setEmail}
            editable={!busy}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            placeholder="caregiver@example.com"
            placeholderTextColor="#9BB4A9"
            returnKeyType="next"
            onSubmitEditing={() => passwordInput.current?.focus()}
            onFocus={() => setFocus('email')}
            onBlur={() => setFocus('')}
          />
        </View>

        {/* Password */}
        <View>
          <Text style={s.label}>Password</Text>
          <View style={s.passwordRow}>
            <TextInput
              ref={passwordInput}
              accessibilityLabel="Password"
              style={[s.input, { flex: 1 }, focus === 'password' && s.focused]}
              value={password}
              onChangeText={setPassword}
              editable={!busy}
              secureTextEntry={!visible}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Secure password"
              placeholderTextColor="#9BB4A9"
              returnKeyType="next"
              onSubmitEditing={() => confirmPasswordInput.current?.focus()}
              onFocus={() => setFocus('password')}
              onBlur={() => setFocus('')}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={visible ? 'Hide password' : 'Show password'}
              onPress={() => setVisible(!visible)}
              style={s.reveal}>
              <Text style={s.link}>{visible ? 'Hide' : 'Show'}</Text>
            </Pressable>
          </View>
        </View>

        {/* Password Security Criteria checklist */}
        <View style={styles.requirementsBox}>
          <Text style={styles.requirementsTitle}>Password Security Requirements:</Text>

          <Text style={[styles.reqItem, passwordMetrics.minLength ? styles.reqMet : styles.reqUnmet]}>
            {passwordMetrics.minLength ? '✓' : '•'} At least 8 characters
          </Text>

          <Text style={[styles.reqItem, passwordMetrics.hasUpper ? styles.reqMet : styles.reqUnmet]}>
            {passwordMetrics.hasUpper ? '✓' : '•'} At least 1 uppercase letter (A-Z)
          </Text>

          <Text style={[styles.reqItem, passwordMetrics.hasLower ? styles.reqMet : styles.reqUnmet]}>
            {passwordMetrics.hasLower ? '✓' : '•'} At least 1 lowercase letter (a-z)
          </Text>

          <Text style={[styles.reqItem, passwordMetrics.hasNumber ? styles.reqMet : styles.reqUnmet]}>
            {passwordMetrics.hasNumber ? '✓' : '•'} At least 1 number (0-9)
          </Text>

          <Text style={[styles.reqItem, passwordMetrics.hasSymbol ? styles.reqMet : styles.reqUnmet]}>
            {passwordMetrics.hasSymbol ? '✓' : '•'} At least 1 special character (!@#$%...)
          </Text>
        </View>

        {/* Confirm Password */}
        <View>
          <Text style={s.label}>Confirm Password</Text>
          <TextInput
            ref={confirmPasswordInput}
            accessibilityLabel="Confirm Password"
            style={[s.input, focus === 'confirm' && s.focused]}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            editable={!busy}
            secureTextEntry={!visible}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Re-enter your password"
            placeholderTextColor="#9BB4A9"
            returnKeyType="go"
            onSubmitEditing={() => void handleRegister()}
            onFocus={() => setFocus('confirm')}
            onBlur={() => setFocus('')}
          />
        </View>

        {/* Errors & Feedback */}
        {!!error && (
          <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>
            {error}
          </Text>
        )}

        {!!notice && (
          <Text accessibilityLiveRegion="polite" style={styles.successNotice}>
            {notice}
          </Text>
        )}

        <AuthButton
          label={busy ? 'Creating account…' : 'Create Account  →'}
          busy={busy}
          onPress={() => void handleRegister()}
        />
      </View>

      <Pressable accessibilityRole="button" onPress={() => router.push('/(auth)/login')}>
        <Text style={s.note}>
          Already have an account? <Text style={s.link}>Log in →</Text>
        </Text>
      </Pressable>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  requirementsBox: {
    backgroundColor: 'rgba(0,0,0,0.15)',
    padding: 12,
    borderRadius: 10,
    marginTop: 4,
    marginBottom: 4,
  },
  requirementsTitle: {
    color: '#EDF3ED',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  reqItem: {
    fontSize: 12,
    lineHeight: 18,
  },
  reqMet: {
    color: '#D9EBAA',
    fontWeight: '600',
  },
  reqUnmet: {
    color: '#9BB4A9',
  },
  highlightEmail: {
    color: '#D9EBAA',
    fontWeight: '700',
  },
  successNotice: {
    color: '#D9EBAA',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
});

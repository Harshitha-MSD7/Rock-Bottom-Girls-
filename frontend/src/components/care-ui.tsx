import { useCallback, useState, type PropsWithChildren } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@/contexts/auth-context';
import { fetchPatients, type PatientStatus } from '@/services/api';

export function usePatients() {
  const { session } = useAuth();
  const [patients, setPatients] = useState<PatientStatus[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      let active = true;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout>;
      async function load() {
        try {
          const rows = await fetchPatients(session!.access_token, controller.signal);
          if (active) {
            setPatients(rows);
            setError('');
          }
        } catch (e) {
          if (active) {
            setPatients([]);
            setError(e instanceof Error ? e.message : 'Could not load patients.');
          }
        } finally {
          if (active) {
            setLoading(false);
            timer = setTimeout(load, 5000);
          }
        }
      }
      void load();
      return () => {
        active = false;
        controller.abort();
        clearTimeout(timer);
      };
    }, [session, revision]),
  );
  return { patients, error, loading, session, reload: () => setRevision((v) => v + 1) };
}
export function CareScreen({
  title,
  subtitle,
  children,
}: PropsWithChildren<{ title: string; subtitle: string }>) {
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={ui.screen}>
      <Text style={ui.eyebrow}>CAREQ / YOUR CARE CIRCLE</Text>
      <Text accessibilityRole="header" style={ui.title}>
        {title}
      </Text>
      <Text style={ui.note}>{subtitle}</Text>
      {children}
    </ScrollView>
  );
}
export function Action({
  label,
  onPress,
  disabled = false,
  secondary = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        ui.button,
        secondary && ui.secondary,
        (disabled || pressed) && { opacity: 0.55 },
      ]}>
      <Text style={[ui.buttonText, secondary && { color: '#173E35' }]}>{label}</Text>
    </Pressable>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={ui.field}>
      <Text style={ui.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#70857C"
        {...props}
        style={[ui.input, props.style]}
      />
    </View>
  );
}
export function Notice({ text, error = false }: { text?: string; error?: boolean }) {
  return text ? (
    <Text
      accessibilityRole={error ? 'alert' : undefined}
      accessibilityLiveRegion="polite"
      style={[ui.note, error && { color: '#A32925' }]}>
      {text}
    </Text>
  ) : null;
}
export function PatientPicker({
  patients,
  id,
  onChange,
  disabled = false,
}: {
  patients: PatientStatus[];
  id: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <View style={ui.picker}>
      {patients.map(({ patient }) => (
        <Pressable
          key={patient.id}
          accessibilityRole="button"
          accessibilityState={{ selected: id === patient.id, disabled }}
          disabled={disabled}
          onPress={() => onChange(patient.id)}
          style={[ui.chip, id === patient.id && ui.selected]}>
          <Text style={{ color: id === patient.id ? '#FFF' : '#173E35' }}>
            {patient.display_name || 'Patient'}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
export function Loading({ loading }: { loading: boolean }) {
  return loading ? <ActivityIndicator accessibilityLabel="Loading patients" /> : null;
}
export const ui = StyleSheet.create({
  screen: { flexGrow: 1, padding: 22, gap: 16, backgroundColor: '#EDF2EC' },
  eyebrow: { fontSize: 11, letterSpacing: 2, color: '#4D6B5E' },
  title: { fontSize: 32, fontWeight: '700', color: '#153E35', lineHeight: 38 },
  note: { fontSize: 15, lineHeight: 22, color: '#4D655A' },
  panel: {
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderColor: '#D6E3D8',
    borderWidth: 1,
    borderRadius: 22,
    padding: 20,
    gap: 14,
  },
  label: { fontSize: 14, fontWeight: '600', color: '#284E40' },
  field: { gap: 7 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#A8BDB0',
    borderRadius: 12,
    padding: 12,
    color: '#183D31',
    fontSize: 16,
    backgroundColor: '#FFF',
  },
  button: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: '#173E35',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 12,
  },
  secondary: { backgroundColor: '#DCE7DD' },
  buttonText: { color: '#FFF', fontWeight: '600', fontSize: 15 },
  picker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { padding: 12, borderRadius: 20, backgroundColor: '#DCE7DD' },
  selected: { backgroundColor: '#173E35' },
  row: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
});

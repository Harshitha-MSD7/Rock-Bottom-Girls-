import { useEffect, useState } from 'react';
import { ScrollView, Text, StyleSheet } from 'react-native';
import PatientStatusList from '@/components/patient-status';
import { stopLegacyLocationTracking } from '@/services/location';
import { restorePush } from '@/services/notifications';
import { useAuth } from '@/contexts/auth-context';

export default function DashboardScreen() {
  const { session } = useAuth();
  const [notificationError, setNotificationError] = useState('');
  useEffect(() => {
    if (!session) return;
    let active = true;
    void restorePush(session.access_token, session.user.id)
      .then(() => {
        if (active) setNotificationError('');
      })
      .catch((failure) => {
        if (active)
          setNotificationError(
            failure instanceof Error ? failure.message : 'Check push alerts in Settings.',
          );
      });
    return () => {
      active = false;
    };
  }, [session]);
  useEffect(() => {
    void stopLegacyLocationTracking().catch(() =>
      console.warn('Could not stop legacy phone tracking. Restart the app.'),
    );
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Caretaker Dashboard</Text>
      <Text style={styles.subtitle}>Watch status and the boundary you choose.</Text>
      {!!notificationError && (
        <Text accessibilityRole="alert">Push alerts: {notificationError}</Text>
      )}
      <PatientStatusList />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, alignItems: 'center', padding: 20, backgroundColor: '#F3F4F6' },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 10 },
  subtitle: { fontSize: 16, color: '#666', textAlign: 'center' },
});

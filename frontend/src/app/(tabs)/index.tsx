import { useEffect } from 'react';
import { View, Text, StyleSheet, Button } from 'react-native';
import { startBackgroundLocation } from '../../services/location';

export default function DashboardScreen() {
  useEffect(() => {
    // Automatically trigger background tracking when entering the tabs dashboard
    startBackgroundLocation().catch((err) => {
      console.log('Background tracking start notice:', err.message);
    });
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Caretaker Dashboard</Text>
      <Text style={styles.subtitle}>Background location monitoring is active.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 10 },
  subtitle: { fontSize: 16, color: '#666', textAlign: 'center' },
});
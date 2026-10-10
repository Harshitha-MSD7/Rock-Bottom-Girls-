// app/(tabs)/index.tsx
import { View, Text, StyleSheet } from 'react-native';

export default function DashboardScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.header}>Caretaker Dashboard</Text>
      
      {/* Status Card Placeholder */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Watch Connection Status</Text>
        <Text style={styles.statusConnected}>● Connected</Text>
        <Text style={styles.detailText}>Last location update: Just now</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#F3F4F6',
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    color: '#1F2937',
  },
  card: {
    backgroundColor: '#FFFFFF',
    padding: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 16,
    color: '#6B7280',
    marginBottom: 8,
  },
  statusConnected: {
    fontSize: 18,
    fontWeight: '600',
    color: '#10B981',
    marginBottom: 8,
  },
  detailText: {
    fontSize: 14,
    color: '#9CA3AF',
  },
});
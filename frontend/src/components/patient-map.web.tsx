import { Text, View } from 'react-native';
import type { PatientStatus } from '@/services/api';
export default function PatientMap({
  status,
}: {
  status: PatientStatus;
  onChoose: (lat: number, lng: number) => void;
}) {
  return (
    <View>
      <Text>The interactive map is available in the Android and iPhone app.</Text>
      <Text>
        Home: {status.patient.home_lat ?? 'not set'}, {status.patient.home_lng ?? 'not set'}
      </Text>
      <Text>
        Watch: {status.device?.last_lat ?? 'unknown'}, {status.device?.last_lng ?? 'unknown'}
      </Text>
    </View>
  );
}

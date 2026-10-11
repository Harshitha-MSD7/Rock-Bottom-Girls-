import MapView, { Circle, Marker } from 'react-native-maps';
import Constants from 'expo-constants';
import { Platform, Text } from 'react-native';
import type { PatientStatus } from '@/services/api';
export default function PatientMap({
  status,
  onChoose,
}: {
  status: PatientStatus;
  onChoose: (lat: number, lng: number) => void;
}) {
  const p = status.patient,
    d = status.device;
  const hasHome = p.home_lat != null && p.home_lng != null,
    hasPosition = d?.last_lat != null && d?.last_lng != null;
  if (
    Platform.OS === 'android' &&
    Constants.appOwnership !== 'expo' &&
    !Constants.expoConfig?.extra?.mapsConfigured
  )
    return (
      <Text>
        Configure the Android Maps key and rebuild the development app to display the map. You can
        set home by address in Status.
      </Text>
    );
  if (!hasHome && !hasPosition)
    return <Text>Set home by address in Status, or wait for the watch’s first position.</Text>;
  const center = {
    latitude: Number(hasHome ? p.home_lat : d?.last_lat),
    longitude: Number(hasHome ? p.home_lng : d?.last_lng),
  };
  return (
    <MapView
      key={p.id}
      style={{ height: 360, borderRadius: 20 }}
      initialRegion={{ ...center, latitudeDelta: 0.015, longitudeDelta: 0.015 }}
      onLongPress={(event) =>
        onChoose(event.nativeEvent.coordinate.latitude, event.nativeEvent.coordinate.longitude)
      }>
      {hasHome && (
        <>
          <Marker
            coordinate={{ latitude: Number(p.home_lat), longitude: Number(p.home_lng) }}
            title="Home boundary"
            pinColor="#24734D"
          />
          <Circle
            center={{ latitude: Number(p.home_lat), longitude: Number(p.home_lng) }}
            radius={Number(p.radius_meters)}
            strokeColor="#24734D"
            fillColor="rgba(36,115,77,0.15)"
          />
        </>
      )}
      {hasPosition && (
        <Marker
          coordinate={{ latitude: Number(d!.last_lat), longitude: Number(d!.last_lng) }}
          title={status.location_stale ? 'Last known watch position' : 'Watch position'}
          description={
            status.location_stale
              ? 'Location is stale'
              : d!.freshness_verified
                ? 'Freshness counter verified'
                : 'Freshness not verified'
          }
          pinColor={status.location_stale ? 'gray' : '#B43A2A'}
        />
      )}
    </MapView>
  );
}

import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAuth } from '@/contexts/auth-context';
import {
  fetchPatients,
  lookupHome,
  type HomeCandidate,
  sendControl,
  type ControlAction,
  type PatientStatus,
} from '@/services/api';

const REFRESH_MS = 5000;
const PAUSE_MINUTES = 30;

// One line that sums up the patient, plus whether it needs attention.
function headline(status: PatientStatus): { text: string; tone: 'ok' | 'alert' | 'muted' } {
  const { patient, device } = status;
  if (!device) return { text: 'No watch assigned', tone: 'muted' };
  if (device.connection_state === 'unknown') return { text: 'No watch updates yet', tone: 'muted' };
  if (device.connection_state === 'lost') {
    const last = device.boundary_state === 'unknown' ? 'unknown' : device.boundary_state;
    return { text: `Disconnected · last known position: ${last}`, tone: 'alert' };
  }
  if (status.location_stale) return { text: 'Location stale', tone: 'muted' };
  if (patient.home_lat == null) return { text: 'Set a home location below', tone: 'muted' };
  if (device.boundary_state === 'unknown')
    return { text: 'Boundary not evaluated yet', tone: 'muted' };
  if (device.boundary_state === 'outside') {
    if (status.pause_active) return { text: 'Outside · monitoring paused', tone: 'muted' };
    return { text: 'Out of bounds — ALERT', tone: 'alert' };
  }
  return { text: 'In bounds', tone: 'ok' };
}

function secondsAgo(status: PatientStatus) {
  const seen = status.device?.last_seen_at;
  if (!seen || !status.server_time) return null;
  return Math.max(0, Math.round((Date.parse(status.server_time) - Date.parse(seen)) / 1000));
}

function PatientCard({
  status,
  onControl,
}: {
  status: PatientStatus;
  onControl: (action: ControlAction) => Promise<void>;
}) {
  const { patient, device } = status;
  const [radius, setRadius] = useState(String(Number(patient.radius_meters ?? '')));
  const [address, setAddress] = useState('');
  const [locationNote, setLocationNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState<HomeCandidate | null>(null);
  const { session } = useAuth();
  const requestedPause =
    !!patient.desired_pause_until &&
    Date.parse(patient.desired_pause_until) > Date.parse(status.server_time ?? '');
  const { text, tone } = headline(status);
  const age = secondsAgo(status);

  async function run(action: ControlAction) {
    setBusy(true);
    setLocationNote('');
    try {
      await onControl(action);
      return true;
    } catch (failure) {
      setLocationNote(failure instanceof Error ? failure.message : 'Change not saved.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const radiusNumber = Number(radius);
  const radiusValid = radius.trim() !== '' && radiusNumber >= 1 && radiusNumber <= 1000000;
  const radiusChanged = radiusNumber !== Number(patient.radius_meters);

  const homeSet = patient.home_lat != null && patient.home_lng != null;
  const homeText = !homeSet
    ? 'Not set yet'
    : (patient.home_address ??
      `${Number(patient.home_lat).toFixed(5)}, ${Number(patient.home_lng).toFixed(5)}`);

  async function setHomeFromAddress() {
    setLocationNote('');
    if (!session) return;
    setBusy(true);
    setCandidate(null);
    try {
      setCandidate(await lookupHome(session.access_token, address.trim()));
    } catch (failure) {
      setLocationNote(failure instanceof Error ? failure.message : 'Address lookup failed.');
    } finally {
      setBusy(false);
    }
  }

  // Home becomes wherever this phone is right now.
  async function setHomeHere() {
    setLocationNote('');
    setBusy(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setLocationNote('Location permission is needed to use the position of this phone.');
        return;
      }
      const { coords } = await Location.getCurrentPositionAsync({});
      setCandidate({
        lat: coords.latitude,
        lng: coords.longitude,
        address: 'Set from caregiver phone location',
      });
    } catch {
      setLocationNote('Could not read the location of this phone. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.name}>{patient.display_name ?? 'Patient'}</Text>
      <Text style={[styles.headline, styles[tone]]}>{text}</Text>

      {device && (
        <>
          {age !== null && <Text style={styles.detail}>Last contact: {age} seconds ago</Text>}
          {!device.freshness_verified && (
            <Text style={styles.pending}>
              Location freshness unverified: watch measurement counter not received.
            </Text>
          )}
          {device.distance_meters !== null && (
            <Text style={styles.detail}>
              {status.location_stale ? 'Last known distance' : 'Distance from home'}:{' '}
              {Number(device.distance_meters).toFixed(1)} m
            </Text>
          )}
          {device.battery_percent !== null && (
            <Text style={styles.detail}>Battery: {Number(device.battery_percent)}%</Text>
          )}
          {status.pause_active && device.paused_until && (
            <Text style={styles.detail}>
              Monitoring paused until {new Date(device.paused_until).toLocaleTimeString()}
            </Text>
          )}
          {device.alarm_active && device.audio_silenced && (
            <Text style={styles.detail}>Audio silenced for this alert</Text>
          )}
          {status.settings_pending && (
            <Text style={styles.pending}>Change pending — waiting for the watch to confirm</Text>
          )}

          <Text style={styles.label}>Allowed radius from home (meters)</Text>
          <View style={styles.row}>
            <TextInput
              accessibilityLabel="Allowed radius in meters"
              style={styles.input}
              value={radius}
              onChangeText={setRadius}
              keyboardType="numeric"
              editable={!busy}
            />
            <Pressable
              accessibilityRole="button"
              disabled={busy || !radiusValid || !radiusChanged}
              onPress={() => void run({ action: 'radius', radius_meters: radiusNumber })}
              style={[styles.button, (busy || !radiusValid || !radiusChanged) && styles.dimmed]}>
              <Text style={styles.buttonText}>Save</Text>
            </Pressable>
          </View>

          <Text style={styles.label}>Home location</Text>
          <Text style={styles.detail}>{homeText}</Text>
          <View style={styles.row}>
            <TextInput
              accessibilityLabel="Home address"
              style={styles.input}
              value={address}
              onChangeText={setAddress}
              placeholder="Street, city, state"
              placeholderTextColor="#9CA3AF"
              editable={!busy}
            />
            <Pressable
              accessibilityRole="button"
              disabled={busy || address.trim() === ''}
              onPress={() => void setHomeFromAddress()}
              style={[styles.button, (busy || address.trim() === '') && styles.dimmed]}>
              <Text style={styles.buttonText}>Find</Text>
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void setHomeHere()}
            style={[styles.button, styles.secondary, busy && styles.dimmed]}>
            <Text style={styles.secondaryText}>Use this phone&apos;s current location</Text>
          </Pressable>
          {candidate && (
            <View style={styles.confirmation}>
              <Text style={styles.detail}>Confirm this home: {candidate.address}</Text>
              <Text style={styles.detail}>
                {candidate.lat.toFixed(5)}, {candidate.lng.toFixed(5)}
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                style={styles.button}
                onPress={() =>
                  void (async () => {
                    if (await run({ action: 'home', ...candidate })) {
                      setCandidate(null);
                      setAddress('');
                    }
                  })()
                }>
                <Text style={styles.buttonText}>Use this home</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => setCandidate(null)}>
                <Text style={styles.detail}>Cancel</Text>
              </Pressable>
            </View>
          )}
          <Text
            accessibilityRole="link"
            onPress={() => void Linking.openURL('https://www.openstreetmap.org/copyright')}
            style={styles.detail}>
            Address lookup © OpenStreetMap contributors
          </Text>
          {!!locationNote && <Text style={styles.pending}>{locationNote}</Text>}

          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() =>
                void run(
                  requestedPause
                    ? { action: 'resume' }
                    : { action: 'pause', minutes: PAUSE_MINUTES },
                )
              }
              style={[styles.button, styles.grow, busy && styles.dimmed]}>
              <Text style={styles.buttonText}>
                {requestedPause
                  ? status.pause_active
                    ? 'Resume monitoring'
                    : 'Cancel pending pause'
                  : `Pause ${PAUSE_MINUTES} min`}
              </Text>
            </Pressable>

            {device.boundary_state === 'outside' && (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() =>
                  void run({ action: patient.desired_audio_silenced ? 'unsilence' : 'silence' })
                }
                style={[styles.button, styles.grow, busy && styles.dimmed]}>
                <Text style={styles.buttonText}>
                  {patient.desired_audio_silenced ? 'Unsilence audio' : 'Silence audio'}
                </Text>
              </Pressable>
            )}
          </View>
        </>
      )}
    </View>
  );
}

export default function PatientStatusList() {
  const { session } = useAuth();
  const token = session?.access_token;
  const [patients, setPatients] = useState<PatientStatus[] | null>(null);
  const [error, setError] = useState('');
  const revision = useRef(0);

  // Bumped after a control change to reload straight away.
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    if (!token) return;
    let active = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = () => {
      const startedRevision = revision.current;
      fetchPatients(token, controller.signal)
        .then((list) => {
          if (!active || startedRevision !== revision.current) return;
          setPatients(list);
          setError('');
        })
        .catch((failure) => {
          if (!active || startedRevision !== revision.current) return;
          // Drop the old list so a stale "In bounds" never looks current.
          setPatients(null);
          setError(failure instanceof Error ? failure.message : 'Status unavailable.');
        })
        .finally(() => {
          if (active) timer = setTimeout(load, REFRESH_MS);
        });
    };
    load();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [token, reloads]);

  async function control(patientId: string, action: ControlAction) {
    if (!token) throw new Error('Sign in again to save changes.');
    revision.current += 1;
    await sendControl(token, patientId, action);
    revision.current += 1;
    setReloads((count) => count + 1);
  }

  return (
    <View style={styles.list}>
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          Status unavailable: {error}
        </Text>
      )}
      {!patients && !error && <ActivityIndicator />}
      {patients?.length === 0 && (
        <Text style={styles.detail}>No patients assigned to you yet.</Text>
      )}
      {patients?.map((status) => (
        <PatientCard
          key={status.patient.id}
          status={status}
          onControl={(action) => control(status.patient.id, action)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { alignSelf: 'stretch', gap: 16, marginTop: 20 },
  confirmation: {
    gap: 10,
    padding: 14,
    marginTop: 10,
    backgroundColor: '#E7F0ED',
    borderRadius: 12,
  },
  card: { padding: 16, borderRadius: 12, backgroundColor: '#FFFFFF', gap: 6 },
  name: { fontSize: 18, fontWeight: 'bold', color: '#1F2937' },
  headline: { fontSize: 17, fontWeight: '600' },
  ok: { color: '#17703F' },
  alert: { color: '#B42318' },
  muted: { color: '#4B5563' },
  detail: { fontSize: 14, color: '#4B5563' },
  pending: { fontSize: 14, color: '#92400E' },
  label: { marginTop: 10, fontSize: 14, color: '#4B5563' },
  row: { flexDirection: 'row', gap: 10, marginTop: 6 },
  input: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    fontSize: 16,
    color: '#1F2937',
  },
  button: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#123D36',
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: { flex: 1 },
  secondary: { marginTop: 6, backgroundColor: '#E5E7EB' },
  secondaryText: { color: '#1F2937', fontSize: 15, fontWeight: '600' },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  dimmed: { opacity: 0.5 },
  error: { color: '#B42318', fontSize: 14 },
});

import { useState } from 'react';
import { View } from 'react-native';
import {
  Action,
  CareScreen,
  Loading,
  Notice,
  PatientPicker,
  ui,
  usePatients,
} from '@/components/care-ui';
import PatientMap from '@/components/patient-map';
import { sendControl } from '@/services/api';
export default function MapScreen() {
  const { patients, session, loading, error, reload } = usePatients();
  const [selection, setSelection] = useState(''),
    [point, setPoint] = useState<{ lat: number; lng: number } | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const selected = patients.find((p) => p.patient.id === selection) ?? patients[0];
  async function save() {
    if (!session || !point || !selected) return;
    setBusy(true);
    try {
      await sendControl(session.access_token, selected.patient.id, {
        action: 'home',
        ...point,
        address: 'Chosen on map',
      });
      setPoint(null);
      setNotice('Home updated. Waiting for fresh watch measurements.');
      reload();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not save home.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <CareScreen
      title="Home & location"
      subtitle="The green circle is the chosen home boundary. Long-press the map to choose a different center.">
      <Loading loading={loading} />
      <Notice text={error} error />
      <PatientPicker
        patients={patients}
        id={selected?.patient.id ?? ''}
        disabled={busy}
        onChange={(id) => {
          setSelection(id);
          setPoint(null);
        }}
      />
      {selected ? (
        <>
          <PatientMap
            status={selected}
            onChoose={(lat, lng) => {
              if (!busy) setPoint({ lat, lng });
            }}
          />
          {selected.location_stale && (
            <Notice text="This is the last known position, not a live location." />
          )}
          {point && (
            <View style={ui.panel}>
              <Notice text={`Set home to ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}?`} />
              <Action label="Confirm home" disabled={busy} onPress={() => void save()} />
              <Action label="Cancel" secondary disabled={busy} onPress={() => setPoint(null)} />
            </View>
          )}
        </>
      ) : (
        !loading && <Notice text="Add a patient to get started." />
      )}
      <Notice text={notice} />
    </CareScreen>
  );
}

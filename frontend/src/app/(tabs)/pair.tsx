import { useState } from 'react';
import { Text, View } from 'react-native';
import {
  Action,
  CareScreen,
  Field,
  Loading,
  Notice,
  PatientPicker,
  ui,
  usePatients,
} from '@/components/care-ui';
import { request } from '@/services/api';

export default function PairScreen() {
  const { patients, session, error, loading, reload } = usePatients();
  const [selection, setSelection] = useState(''),
    [product, setProduct] = useState(''),
    [code, setCode] = useState(''),
    [address, setAddress] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [confirm, setConfirm] = useState(false);
  const selected = patients.find((p) => p.patient.id === selection) ?? patients[0];
  // byAddress: the backend asks the watch at that address for its product ID.
  async function pair(unpair = false, byAddress = false) {
    if (!session || !selected) return;
    setBusy(true);
    setNotice('');
    try {
      const body = byAddress
        ? { watch_url: address.trim() }
        : { product_id: product.trim(), pairing_code: code.trim() };
      await request(
        session.access_token,
        `/api/patients/${selected.patient.id}/watch`,
        unpair ? undefined : body,
        unpair ? 'DELETE' : 'POST',
      );
      setCode('');
      setAddress('');
      setConfirm(false);
      setNotice(
        unpair
          ? 'Watch unpaired. It will no longer receive this patient’s settings.'
          : 'Paired. Waiting for the watch to send its first update.',
      );
      reload();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Pairing failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <CareScreen
      title="Connect a watch"
      subtitle="Enter the watch's address while it is on the same network as the backend. The watch sends its location every 10 seconds.">
      <Loading loading={loading} />
      <Notice text={error} error />
      <PatientPicker
        patients={patients}
        id={selected?.patient.id ?? ''}
        disabled={busy}
        onChange={(id) => {
          setSelection(id);
          setConfirm(false);
          setNotice('');
        }}
      />
      {!loading && !patients.length && <Notice text="Add a patient in the Patients tab first." />}
      {selected && (
        <View style={ui.panel}>
          <Text style={ui.label}>{selected.patient.display_name}</Text>
          {selected.device?.product_id ? (
            <>
              <Text style={ui.note}>Watch ID: {selected.device.product_id}</Text>
              <Text style={ui.note}>Connection: {selected.device.connection_state}</Text>
              {confirm ? (
                <>
                  <Notice text="Unpairing ends monitoring for this patient. It cannot erase an audio copy already stored on an offline watch." />
                  <Action label="Confirm unpair" disabled={busy} onPress={() => void pair(true)} />
                  <Action
                    label="Cancel"
                    secondary
                    disabled={busy}
                    onPress={() => setConfirm(false)}
                  />
                </>
              ) : (
                <Action label="Unpair watch" secondary onPress={() => setConfirm(true)} />
              )}
            </>
          ) : (
            <>
              <Field
                label="Watch address on this network"
                placeholder="192.168.1.50"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                value={address}
                onChangeText={setAddress}
              />
              <Action
                label={busy ? 'Pairing…' : 'Pair by address'}
                disabled={busy || !address.trim()}
                onPress={() => void pair(false, true)}
              />
              <Text style={ui.note}>Or use the product ID and pairing code:</Text>
              <Field
                label="Watch product ID"
                autoCapitalize="none"
                autoCorrect={false}
                value={product}
                onChangeText={setProduct}
              />
              <Field
                label="Pairing code"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                value={code}
                onChangeText={setCode}
              />
              <Action
                label={busy ? 'Pairing…' : 'Pair watch'}
                disabled={busy || !product.trim() || !code.trim()}
                onPress={() => void pair()}
              />
            </>
          )}
          <Notice text={notice} />
        </View>
      )}
    </CareScreen>
  );
}

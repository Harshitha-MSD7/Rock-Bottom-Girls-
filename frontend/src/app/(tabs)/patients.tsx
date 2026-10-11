import { useState } from 'react';
import { Text, View } from 'react-native';
import { Action, CareScreen, Field, Loading, Notice, ui, usePatients } from '@/components/care-ui';
import { request, type PatientStatus } from '@/services/api';

function Profile({
  item,
  token,
  onSaved,
}: {
  item: PatientStatus;
  token: string;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false),
    [name, setName] = useState(item.patient.display_name ?? ''),
    [phone, setPhone] = useState(item.patient.phone_number ?? ''),
    [contact, setContact] = useState(item.patient.emergency_contact ?? '');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function save() {
    setBusy(true);
    setError('');
    try {
      await request(
        token,
        `/api/patients/${item.patient.id}`,
        { display_name: name, phone_number: phone, emergency_contact: contact },
        'PATCH',
      );
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={ui.panel}>
      <Text style={ui.label}>{item.patient.display_name}</Text>
      {editing ? (
        <>
          <Field label="Patient name" value={name} onChangeText={setName} maxLength={120} />
          <Field
            label="Phone number (optional)"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            maxLength={40}
          />
          <Field
            label="Emergency contact (optional)"
            value={contact}
            onChangeText={setContact}
            maxLength={200}
          />
          <Notice text={error} error />
          <Action
            label={busy ? 'Saving…' : 'Save profile'}
            disabled={busy || !name.trim()}
            onPress={() => void save()}
          />
          <Action label="Cancel" secondary disabled={busy} onPress={() => setEditing(false)} />
        </>
      ) : (
        <>
          <Text style={ui.note}>
            {item.device?.product_id ? `Watch ${item.device.product_id}` : 'No watch paired'}
          </Text>
          <Action
            label="Edit profile"
            secondary
            onPress={() => {
              setName(item.patient.display_name ?? '');
              setPhone(item.patient.phone_number ?? '');
              setContact(item.patient.emergency_contact ?? '');
              setEditing(true);
            }}
          />
        </>
      )}
    </View>
  );
}
export default function PatientsScreen() {
  const { patients, session, error, loading, reload } = usePatients();
  const [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  async function add() {
    if (!session) return;
    setBusy(true);
    setNotice('');
    try {
      await request(session.access_token, '/api/patients', { display_name: name });
      setName('');
      reload();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not create patient.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <CareScreen
      title="Your patients"
      subtitle="Create a profile, then pair their watch. Only your account can manage the patients you create.">
      <View style={ui.panel}>
        <Field
          label="New patient name"
          value={name}
          onChangeText={setName}
          maxLength={120}
          editable={!busy}
        />
        <Action
          label={busy ? 'Adding…' : 'Add patient'}
          disabled={busy || !name.trim()}
          onPress={() => void add()}
        />
        <Notice text={notice} error />
      </View>
      <Loading loading={loading} />
      <Notice text={error} error />
      {patients.map((item) => (
        <Profile key={item.patient.id} item={item} token={session!.access_token} onSaved={reload} />
      ))}
    </CareScreen>
  );
}

import { useCallback, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
import {
  Action,
  CareScreen,
  Loading,
  Notice,
  PatientPicker,
  ui,
  usePatients,
} from '@/components/care-ui';
import { API_URL, type PatientStatus } from '@/services/api';

function Recorder({
  item,
  token,
  reload,
}: {
  item: PatientStatus;
  token: string;
  reload: () => void;
}) {
  const [uri, setUri] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const pending = useRef(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY, (status) => {
    if (status.hasError) setNotice(status.error || 'Recording interrupted. Try again.');
    if (status.isFinished && status.url) {
      setUri(status.url);
      void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    }
  });
  const state = useAudioRecorderState(recorder);
  const player = useAudioPlayer(uri);
  useFocusEffect(
    useCallback(
      () => () => {
        player.pause();
        if (recorder.isRecording) void recorder.stop().catch(() => {});
      },
      [player, recorder],
    ),
  );
  async function record() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setNotice('');
    try {
      player.pause();
      if (recorder.isRecording) {
        await recorder.stop();
        setUri(recorder.uri);
        await setAudioModeAsync({ allowsRecording: false });
      } else {
        const permission = await AudioModule.requestRecordingPermissionsAsync();
        if (!permission.granted)
          throw new Error('Allow microphone access in phone settings to record a message.');
        setUri(null);
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        recorder.record({ forDuration: 60 });
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not record.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function upload() {
    if (!uri || !API_URL || pending.current) return;
    pending.current = true;
    setBusy(true);
    setNotice('');
    player.pause();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const body = Platform.OS === 'web' ? await (await fetch(uri)).blob() : new File(uri);
      const response = await expoFetch(`${API_URL}/api/patients/${item.patient.id}/audio`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
        body,
        signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Upload failed.');
      setNotice('Uploaded and converted to WAV. The watch will download it on its next update.');
      reload();
    } catch (e) {
      setNotice(
        e instanceof Error
          ? e.message
          : 'Upload failed. Your recording is still available to retry.',
      );
    } finally {
      clearTimeout(timer);
      pending.current = false;
      setBusy(false);
    }
  }
  const installed =
    item.patient.audio_version &&
    item.device?.installed_audio_version === item.patient.audio_version;
  return (
    <View style={ui.panel}>
      <Text style={ui.label}>{item.patient.display_name}</Text>
      <Notice text="Speak clearly: name, caregiver’s phone number, and a short instruction. Maximum 60 seconds." />
      <Text style={ui.title}>{Math.floor(state.durationMillis / 1000)}s / 60s</Text>
      <Action
        label={state.isRecording ? 'Stop recording' : 'Record a message'}
        disabled={busy}
        onPress={() => void record()}
      />
      {uri && !state.isRecording && (
        <>
          <Action
            label="Preview recording"
            secondary
            disabled={busy}
            onPress={() => {
              player.replace(uri);
              player.play();
            }}
          />
          <Action
            label={busy ? 'Uploading…' : 'Upload for this patient'}
            disabled={busy || !API_URL}
            onPress={() => void upload()}
          />
        </>
      )}
      {item.patient.audio_version && (
        <>
          <Notice
            text={
              installed
                ? 'Saved on watch (confirmed by device).'
                : 'Stored in backend; waiting for the watch to confirm download.'
            }
          />
          <Action
            label="Play uploaded message"
            secondary
            disabled={busy || state.isRecording}
            onPress={() => {
              player.replace({
                uri: `${API_URL}/api/patients/${item.patient.id}/audio`,
                headers: { Authorization: `Bearer ${token}` },
              });
              player.play();
            }}
          />
        </>
      )}
      <Action label="Stop playback" secondary onPress={() => player.pause()} />
      <Notice text={notice} />
    </View>
  );
}
export default function RecordScreen() {
  const { patients, session, error, loading, reload } = usePatients();
  const [selection, setSelection] = useState('');
  const selected = patients.find((p) => p.patient.id === selection) ?? patients[0];
  return (
    <CareScreen
      title="A familiar voice"
      subtitle="Record a message to help someone nearby contact you. The watch keeps its installed copy when offline.">
      <Loading loading={loading} />
      <Notice text={error} error />
      <PatientPicker patients={patients} id={selected?.patient.id ?? ''} onChange={setSelection} />
      {selected && session ? (
        <Recorder
          key={selected.patient.id}
          item={selected}
          token={session.access_token}
          reload={reload}
        />
      ) : (
        !loading && <Notice text="Add a patient in the Patients tab first." />
      )}
    </CareScreen>
  );
}

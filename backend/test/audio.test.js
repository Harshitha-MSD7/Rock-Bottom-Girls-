const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inspectWav, toWav, createAudioService } = require('../src/audio');
const { createApp } = require('../src/app');
function wav(seconds = 1) {
  const b = Buffer.alloc(44 + 32000 * seconds);
  b.write('RIFF');
  b.writeUInt32LE(b.length - 8, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(b.length - 44, 40);
  return b;
}
test('real FFmpeg conversion produces valid mono 16k WAV; invalid uploads rejected', async () => {
  assert.equal(inspectWav(await toWav(wav())).duration_seconds, 1);
  await assert.rejects(toWav(Buffer.from('not audio')), /could not be converted/);
  assert.throws(() => inspectWav(wav(61)), /60 seconds/);
  assert.throws(() => inspectWav(wav().subarray(0, 40)), /Invalid WAV/);
});
test('recording upload saves metadata only after storage; failed database write cleans new object', async () => {
  const calls = [];
  let saved;
  const storage = {
    put: async (name) => calls.push(['put', name]),
    remove: async (name) => calls.push(['remove', name]),
    get: async () => wav(),
  };
  const store = {
    saveAudio: async (user, id, audio) => {
      assert.equal(user, 'caregiver');
      saved = audio;
      calls.push(['save']);
      return 'old.wav';
    },
  };
  const service = createAudioService({ store, storage, convert: async () => wav() });
  const result = await service.upload('caregiver', 'patient', Buffer.from('source'));
  assert.equal(result.sha256.length, 64);
  assert.equal(saved.version, result.version);
  assert.deepEqual(
    calls.map((c) => c[0]),
    ['put', 'save', 'remove'],
  );
  assert.equal(calls[2][1], 'old.wav');
  store.saveAudio = async () => {
    throw new Error('database unavailable');
  };
  calls.length = 0;
  await assert.rejects(service.upload('caregiver', 'patient', wav()), /database unavailable/);
  assert.equal(calls[0][1], calls[1][1]);
});
test('audio HTTP routes enforce user ownership, watch authentication and current version', async () => {
  const id = '11111111-1111-4111-8111-111111111111',
    version = '22222222-2222-4222-8222-222222222222';
  let uploads = 0;
  const { app } = createApp({
    verifyUser: async (t) => (t === 'owner' ? 'owner' : t === 'other' ? 'other' : null),
    deviceSecrets: { watch: 'a'.repeat(32) },
    store: {
      assigned: async (u, p) => u === 'owner' && p === id,
      devicePatient: async () => id,
      patientRow: async () => ({ audio_version: version }),
    },
    audioService: {
      upload: async () => {
        uploads++;
        return { version };
      },
      download: async () => wav(),
    },
  });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${server.address().port}`;
  try {
    const upload = (token) =>
      fetch(`${base}/api/patients/${id}/audio`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'audio/wav' },
        body: wav(),
      });
    assert.equal((await upload('bad')).status, 401);
    assert.equal((await upload('other')).status, 403);
    assert.equal(uploads, 0);
    assert.equal((await upload('owner')).status, 200);
    assert.equal(uploads, 1);
    assert.equal(
      (
        await fetch(`${base}/api/patients/${id}/audio`, {
          headers: { Authorization: 'Bearer other' },
        })
      ).status,
      403,
    );
    const headers = { 'X-Device-Id': 'watch', Authorization: `Bearer ${'a'.repeat(32)}` };
    assert.equal((await fetch(`${base}/api/watch/audio/old`, { headers })).status, 409);
    const response = await fetch(`${base}/api/watch/audio/${version}`, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.arrayBuffer()).byteLength, wav().length);
  } finally {
    server.close();
  }
});

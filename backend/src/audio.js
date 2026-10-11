const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { fail } = require('./monitoring');
const exec = promisify(execFile);

function inspectWav(bytes) {
  if (
    bytes.length < 44 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WAVE'
  )
    fail('Invalid WAV audio');
  let format, size;
  for (let at = 12; at + 8 <= bytes.length;) {
    const name = bytes.toString('ascii', at, at + 4),
      length = bytes.readUInt32LE(at + 4),
      start = at + 8;
    if (start + length > bytes.length) fail('Incomplete WAV audio');
    if (name === 'fmt ' && length >= 16)
      format = {
        codec: bytes.readUInt16LE(start),
        channels: bytes.readUInt16LE(start + 2),
        rate: bytes.readUInt32LE(start + 4),
        bits: bytes.readUInt16LE(start + 14),
      };
    if (name === 'data') size = length;
    at = start + length + (length % 2);
  }
  if (
    !format ||
    format.codec !== 1 ||
    format.channels !== 1 ||
    format.rate !== 16000 ||
    format.bits !== 16 ||
    !size ||
    size > 1920000
  )
    fail('Record between 1 and 60 seconds of audio');
  if (size < 32000) fail('Record at least one second');
  return { duration_seconds: size / 32000 };
}
async function toWav(bytes) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'careq-audio-'));
  try {
    const source = path.join(directory, 'input'),
      output = path.join(directory, 'message.wav');
    await fs.writeFile(source, bytes);
    await exec(
      process.env.FFMPEG_PATH || require('ffmpeg-static'),
      [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-protocol_whitelist',
        'file,pipe',
        '-format_whitelist',
        'wav,mov,matroska,webm,ogg,mp3,aac',
        '-i',
        source,
        '-map',
        '0:a:0',
        '-vn',
        '-t',
        '61',
        '-ar',
        '16000',
        '-ac',
        '1',
        '-c:a',
        'pcm_s16le',
        output,
      ],
      { timeout: 20000, maxBuffer: 65536, windowsHide: true },
    );
    const wav = await fs.readFile(output);
    inspectWav(wav);
    return wav;
  } catch (error) {
    if (error.status) throw error;
    fail('Audio could not be converted. Try recording again.', 400);
  } finally {
    const target = path.resolve(directory),
      root = path.resolve(os.tmpdir());
    if (path.dirname(target) !== root || !path.basename(target).startsWith('careq-audio-'))
      throw new Error('Unexpected audio temporary directory');
    await fs.rm(target, { recursive: true, force: true });
  }
}
function createAudioService({ store, storage, convert = toWav }) {
  let processing = 0;
  return {
    async upload(userId, patientId, bytes) {
      if (processing >= 2) fail('Recording service busy. Try again shortly.', 429);
      processing++;
      let object;
      try {
        const wav = await convert(bytes),
          details = inspectWav(wav),
          version = randomUUID();
        object = `${patientId}/${version}.wav`;
        const sha256 = createHash('sha256').update(wav).digest('hex');
        await storage.put(object, wav);
        let old;
        try {
          old = await store.saveAudio(userId, patientId, { path: object, version, sha256 });
        } catch (error) {
          await storage.remove(object).catch(() => {});
          throw error;
        }
        if (old && old !== object)
          await storage.remove(old).catch(() => console.warn('Old recording cleanup deferred'));
        return {
          version,
          sha256,
          ...details,
          status: 'uploaded',
          format: 'WAV PCM 16-bit mono 16000 Hz',
        };
      } finally {
        processing--;
      }
    },
    async download(patient) {
      if (!patient?.audio_storage_path) fail('No recording uploaded', 404);
      return storage.get(patient.audio_storage_path);
    },
  };
}
function supabaseAudioStorage(url, key) {
  const { createClient } = require('@supabase/supabase-js');
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }),
    },
  });
  const bucket = client.storage.from('patient-audio');
  return {
    async put(name, bytes) {
      const { error } = await bucket.upload(name, bytes, {
        contentType: 'audio/wav',
        upsert: false,
      });
      if (error) fail('Private audio storage unavailable', 503);
    },
    async get(name) {
      const { data, error } = await bucket.download(name);
      if (error) fail('Recording unavailable', 503);
      return Buffer.from(await data.arrayBuffer());
    },
    async remove(name) {
      const { error } = await bucket.remove([name]);
      if (error) throw error;
    },
  };
}
module.exports = { inspectWav, toWav, createAudioService, supabaseAudioStorage };

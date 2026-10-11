import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, supabase } from '../middleware/auth.js';

const router = Router();

// GET /device/ping (Health check)
router.get('/ping', (req, res) => {
  return res.status(200).json({ message: 'Device router is working!' })
});

// POST /device/push-token (Registers Expo notification token for caregiver)
const pushTokenSchema = z.object({
  token: z.string().min(1)
});

router.post('/push-token', requireAuth, async (req, res) => {
  const parsed = pushTokenSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ errors: parsed.error.issues });
  }

  const { token } = parsed.data;

  // Insert or update token for this caregiver
  const { error } = await supabase
    .from('push_tokens')
    .upsert(
      { caregiver_id: req.user.id, token },
      { onConflict: 'caregiver_id, token' }
    );

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(201).json({ status: 'push token registered' });
});

// POST /device/location (Caregiver updates geofence center / home coordinates)
const locationSchema = z.object({
  patient_id: z.string().uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180)
});

router.post('/location', requireAuth, async (req, res) => {
  const parsed = locationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ errors: parsed.error.issues });
  }

  const { patient_id, latitude, longitude } = parsed.data;

  // Verify caregiver assignment (403 Check)
  const { data: assignment, error: assignErr } = await supabase
    .from('caregiver_patients')
    .select('*')
    .eq('caregiver_id', req.user.id)
    .eq('patient_id', patient_id)
    .single();

  if (assignErr || !assignment) {
    return res.status(403).json({ error: 'Caregiver does not have access to this patient' });
  }

  const { error } = await supabase
    .from('patients')
    .update({
      home_lat: latitude,
      home_lng: longitude
    })
    .eq('id', patient_id);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(201).json({ status: 'location received' });
});

// POST /device/configure (Updates geofence radius, audio silence, pauses, or audio path)
const configureSchema = z.object({
  patient_id: z.string().uuid(),
  radius_meters: z.number().positive().optional(),
  desired_audio_silenced: z.boolean().optional(),
  desired_pause_until: z.string().datetime().optional().nullable(),
  audio_storage_path: z.string().optional()
});

router.post('/configure', requireAuth, async (req, res) => {
  const parsed = configureSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ errors: parsed.error.issues });
  }

  const { patient_id, radius_meters, desired_audio_silenced, desired_pause_until, audio_storage_path } = parsed.data;

  // Get current settings_version to increment it
  const { data: patient, error: fetchErr } = await supabase
    .from('patients')
    .select('settings_version')
    .eq('id', patient_id)
    .single();

  if (fetchErr || !patient) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  const updatePayload = {
    settings_version: (patient.settings_version || 0) + 1
  };

  if (radius_meters !== undefined) updatePayload.radius_meters = radius_meters;
  if (desired_audio_silenced !== undefined) updatePayload.desired_audio_silenced = desired_audio_silenced;
  if (desired_pause_until !== undefined) updatePayload.desired_pause_until = desired_pause_until;
  if (audio_storage_path !== undefined) updatePayload.audio_storage_path = audio_storage_path;

  const { data: updatedPatient, error: updateErr } = await supabase
    .from('patients')
    .update(updatePayload)
    .eq('id', patient_id)
    .select()
    .single();

  if (updateErr) {
    return res.status(500).json({ error: updateErr.message });
  }

  return res.status(200).json({
    status: 'configuration updated',
    patient: updatedPatient
  });
});

// GET /device/watch-status (Caregiver app inspects watch state, battery, and alerts)
router.get('/watch-status', requireAuth, async (req, res) => {
  const { patient_id } = req.query;
  if (!patient_id) {
    return res.status(400).json({ error: 'Missing patient_id' });
  }

  const { data: device, error } = await supabase
    .from('devices')
    .select('*')
    .eq('patient_id', patient_id)
    .single();

  if (error || !device) {
    return res.status(404).json({ error: 'Device not found for this patient' });
  }

  return res.status(200).json({
    device_id: device.id,
    last_position: {
      latitude: device.last_lat,
      longitude: device.last_lng,
      distance_meters: device.distance_meters,
      last_position_at: device.last_position_at
    },
    battery_percent: device.battery_percent,
    connection_state: device.connection_state,
    alarm_active: device.alarm_active,
    boundary_state: device.boundary_state,
    audio_silenced: device.audio_silenced,
    last_seen_at: device.last_seen_at,
    applied_settings_version: device.applied_settings_version
  });
});

module.exports = router;
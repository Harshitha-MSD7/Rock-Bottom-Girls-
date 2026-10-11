const express = require('express');
const { z } = require('zod');
const { supabase } = require('../middleware/auth.js');

const router = express.Router();

// Helper function to dispatch Expo Push Notifications to caregivers
async function notifyCaregiversOfPatient(patientId, title, message) {
  try {
    const { data: caregivers } = await supabase
      .from('caregiver_patients')
      .select('caregiver_id')
      .eq('patient_id', patientId);

    if (!caregivers || caregivers.length === 0) return;

    const caregiverIds = caregivers.map(c => c.caregiver_id);
    const { data: tokens } = await supabase
      .from('push_tokens')
      .select('token')
      .in('caregiver_id', caregiverIds);

    if (!tokens || tokens.length === 0) return;

    const pushPayloads = tokens.map(t => ({
      to: t.token,
      sound: 'default',
      title,
      body: message,
      priority: 'high'
    }));

    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pushPayloads)
    });
  } catch (err) {
    console.error('Error sending push notification:', err.message);
  }
}

// GET /watch/status (Watch heartbeat & geofence rules poll)
router.get('/status', async (req, res) => {
  const { device_id } = req.query
  if (!device_id) {
    return res.status(400).json({ error: 'Missing device_id' });
  }

  // Update heartbeat
  await supabase
    .from('devices')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', device_id);

  // Fetch device and associated patient settings
  const { data: device, error: devErr } = await supabase
    .from('devices')
    .select('*, patients(*)')
    .eq('id', device_id)
    .single();

  if (devErr || !device || !device.patients) {
    return res.status(404).json({ error: 'Device or linked patient not found' });
  }

  const patient = device.patients;

  return res.status(200).json({
    location: {
      latitude: patient.home_lat,
      longitude: patient.home_lng
    },
    radius_meters: patient.radius_meters,
    is_silenced: patient.desired_audio_silenced,
    audio_storage_path: patient.audio_storage_path,
    desired_pause_until: patient.desired_pause_until,
    settings_version: patient.settings_version
  });
});

// POST /watch/position (Watch uploads trilaterated position and device status)
const positionSchema = z.object({
  device_id: z.string().uuid(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  battery_percent: z.number().min(0).max(100).optional(),
  distance_meters: z.number().optional(),
  boundary_state: z.string().optional(),
  connection_state: z.string().optional(),
  audio_silenced: z.boolean().optional(),
  paused_until: z.string().datetime().optional().nullable(),
  applied_settings_version: z.number().int().optional()
});

router.post('/position', async (req, res) => {
  const parsed = positionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ errors: parsed.error.issues });
  }

  const {
    device_id,
    latitude,
    longitude,
    battery_percent,
    distance_meters,
    boundary_state,
    connection_state,
    audio_silenced,
    paused_until,
    applied_settings_version
  } = parsed.data;

  const updateData = {
    last_position_at: new Date().toISOString()
  };

  if (latitude !== undefined) updateData.last_lat = latitude;
  if (longitude !== undefined) updateData.last_lng = longitude;
  if (battery_percent !== undefined) updateData.battery_percent = battery_percent;
  if (distance_meters !== undefined) updateData.distance_meters = distance_meters;
  if (boundary_state !== undefined) updateData.boundary_state = boundary_state;
  if (connection_state !== undefined) updateData.connection_state = connection_state;
  if (audio_silenced !== undefined) updateData.audio_silenced = audio_silenced;
  if (paused_until !== undefined) updateData.paused_until = paused_until;
  if (applied_settings_version !== undefined) updateData.applied_settings_version = applied_settings_version;

  const { error } = await supabase
    .from('devices')
    .update(updateData)
    .eq('id', device_id);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ status: 'Position updated' });
});

// POST /watch/incident (Watch triggers or dismisses alarms & alerts caregiver via push)
const incidentSchema = z.object({
  device_id: z.string().uuid(),
  kind: z.enum(['out_of_bounds', 'dismissed', 'in_bounds'])
});

router.post('/incident', async (req, res) => {
  const parsed = incidentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ errors: parsed.error.issues });
  }

  const { device_id, kind } = parsed.data;
  const isAlarm = kind === 'out_of_bounds';

  const { data: device, error: updateErr } = await supabase
    .from('devices')
    .update({
      alarm_active: isAlarm,
      boundary_state: kind
    })
    .eq('id', device_id)
    .select('*, patients(display_name)')
    .single();

  if (updateErr || !device) {
    return res.status(500).json({ error: updateErr?.message || 'Device not found' });
  }

  // If a breach triggered, notify assigned caregivers
  if (isAlarm && device.patient_id) {
    const patientName = device.patients?.display_name || 'Patient';
    await notifyCaregiversOfPatient(
      device.patient_id,
      'CareQ Alert: Perimeter Breach!',
      `${patientName} has moved outside the designated safe boundary.`
    );
  }

  return res.status(201).json({
    device_id,
    alarm_active: isAlarm,
    status: 'logged'
  });
});

module.exports = router;

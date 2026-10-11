// Calls to the careQ Express backend. Every request carries the caregiver's
// Supabase access token; the backend checks it and the patient assignment.
export const API_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');

export type PatientStatus = {
  patient: {
    id: string;
    display_name?: string;
    phone_number?: string | null;
    emergency_contact?: string | null;
    audio_version?: string | null;
    radius_meters?: number | string;
    // null until the caregiver sets a home location.
    home_lat?: number | string | null;
    home_lng?: number | string | null;
    home_address?: string | null;
    desired_pause_until?: string | null;
    desired_audio_silenced?: boolean;
  };
  // null when no watch is assigned to the patient yet.
  device: {
    product_id?: string | null;
    paired?: boolean;
    last_lat?: number | string | null;
    last_lng?: number | string | null;
    freshness_verified?: boolean;
    installed_audio_version?: string | null;
    connection_state: 'unknown' | 'connected' | 'lost';
    boundary_state: 'unknown' | 'inside' | 'outside';
    distance_meters: number | null;
    battery_percent: number | string | null;
    last_seen_at: string | null;
    paused_until: string | null;
    audio_silenced: boolean;
    alarm_active: boolean;
  } | null;
  message?: string;
  location_stale?: boolean;
  pause_active?: boolean;
  settings_pending?: boolean;
  server_time?: string;
};

export type ControlAction =
  | { action: 'radius'; radius_meters: number }
  // Give either an address (the backend looks it up) or exact coordinates.
  | { action: 'home'; address: string }
  | { action: 'home'; lat: number; lng: number; address?: string }
  | { action: 'pause'; minutes: number }
  | { action: 'resume' }
  | { action: 'silence' }
  | { action: 'unsilence' };

export async function request<T>(
  token: string,
  path: string,
  body?: unknown,
  method = body ? 'POST' : 'GET',
  signal?: AbortSignal,
): Promise<T> {
  if (!API_URL) {
    throw new Error('Add EXPO_PUBLIC_API_URL to .env.local, then restart Expo.');
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort);
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, 12000);
  try {
    const response = await fetch(API_URL + path, {
      method,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(result?.error ?? 'The server could not complete the request.');
    }
    return result as T;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export function fetchPatients(token: string, signal?: AbortSignal) {
  return request<PatientStatus[]>(token, '/api/patients', undefined, 'GET', signal);
}

export type HomeCandidate = { lat: number; lng: number; address: string };
export const lookupHome = (token: string, address: string) =>
  request<HomeCandidate>(token, '/api/geocode', { address });

export function sendControl(token: string, patientId: string, action: ControlAction) {
  return request<PatientStatus>(token, `/api/patients/${patientId}/control`, action);
}

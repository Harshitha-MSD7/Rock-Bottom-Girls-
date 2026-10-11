// All writes for a patient lock the same row, across API requests and workers.
// A failed transaction never partially applies settings or device state.
class Store {
  constructor(pool) {
    this.pool = pool;
    this.queuesNotifications = true;
  }
  async assigned(userId, patientId) {
    const { rows } = await this.pool.query(
      'select 1 from caregiver_patients where caregiver_id=$1 and patient_id=$2',
      [userId, patientId],
    );
    return rows.length > 0;
  }
  async patientIds(userId) {
    const { rows } = await this.pool.query(
      'select patient_id from caregiver_patients where caregiver_id=$1 order by patient_id',
      [userId],
    );
    return rows.map((row) => row.patient_id);
  }
  async allPatientIds() {
    const { rows } = await this.pool.query('select patient_id from devices order by patient_id');
    return rows.map((row) => row.patient_id);
  }
  async devicePatient(id) {
    const { rows } = await this.pool.query('select patient_id from devices where id=$1', [id]);
    return rows[0]?.patient_id;
  }
  async transact(id, fn, userId) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const { rows: patients } = await client.query(
        'select * from patients where id=$1 for update',
        [id],
      );
      if (!patients.length) throw Object.assign(new Error('Patient not found'), { status: 404 });
      if (userId) {
        const allowed = await client.query(
          'select 1 from caregiver_patients where caregiver_id=$1 and patient_id=$2 for share',
          [userId, id],
        );
        if (!allowed.rows.length)
          throw Object.assign(new Error('Patient access denied'), { status: 403 });
      }
      const { rows: devices } = await client.query(
        'select * from devices where patient_id=$1 for update',
        [id],
      );
      if (!devices.length)
        throw Object.assign(new Error('No watch assigned to this patient'), { status: 409 });
      const now = Date.now();
      const result = fn(patients[0], devices[0], now);
      const p = result.patient,
        d = result.device;
      await client.query(
        `update patients set radius_meters=$2, desired_pause_until=$3, desired_audio_silenced=$4,
        settings_version=$5, home_lat=$6, home_lng=$7, home_address=$8 where id=$1`,
        [
          id,
          p.radius_meters,
          p.desired_pause_until,
          p.desired_audio_silenced,
          p.settings_version,
          p.home_lat,
          p.home_lng,
          p.home_address,
        ],
      );
      await client.query(
        `update devices set last_seen_at=$2,last_position_at=$3,last_lat=$4,last_lng=$5,battery_percent=$6,
        boundary_state=$7,connection_state=$8,distance_meters=$9,paused_until=$10,audio_silenced=$11,
        applied_settings_version=$12,alarm_active=$13 where id=$1`,
        [
          d.id,
          d.last_seen_at,
          d.last_position_at,
          d.last_lat,
          d.last_lng,
          d.battery_percent,
          d.boundary_state,
          d.connection_state,
          d.distance_meters,
          d.paused_until,
          d.audio_silenced,
          d.applied_settings_version,
          d.alarm_active,
        ],
      );
      for (const event of result.events) {
        // Transient delivery jobs, not incident history. Created in the same
        // transaction as status so a restart cannot silently lose an alert.
        await client.query(
          `insert into notification_outbox(patient_id, caregiver_id, token, event)
          select $1, pt.caregiver_id, pt.token, $2 from push_tokens pt
          join caregiver_patients cp using(caregiver_id) where cp.patient_id=$1`,
          [id, event],
        );
      }
      await client.query('commit');
      return { ...result, now };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
  async tokens(patientId) {
    const { rows } = await this.pool.query(
      'select distinct token from push_tokens join caregiver_patients using(caregiver_id) where patient_id=$1',
      [patientId],
    );
    return rows.map((row) => row.token);
  }
  async registerToken(userId, token) {
    // Ownership cannot be stolen through an upsert on another caregiver's token.
    const result = await this.pool.query(
      `insert into push_tokens(caregiver_id,token) values($1,$2)
      on conflict(token) do update set token=excluded.token where push_tokens.caregiver_id=excluded.caregiver_id returning id`,
      [userId, token],
    );
    if (!result.rows.length)
      throw Object.assign(new Error('Token is already registered to another account'), {
        status: 409,
      });
  }
  async removeToken(userId, token) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('delete from push_tokens where caregiver_id=$1 and token=$2', [
        userId,
        token,
      ]);
      await client.query('delete from notification_outbox where caregiver_id=$1 and token=$2', [
        userId,
        token,
      ]);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}
module.exports = { Store };

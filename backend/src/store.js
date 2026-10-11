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
    const { rows } = await this.pool.query(
      'select patient_id from devices where paired order by patient_id',
    );
    return rows.map((row) => row.patient_id);
  }
  async devicePatient(id) {
    const { rows } = await this.pool.query(
      'select patient_id from devices where paired and (id::text=$1 or product_id=$1)',
      [id],
    );
    return rows[0]?.patient_id;
  }
  async transact(id, fn, userId) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      // Set per transaction so it holds on Supabase's transaction pooler (port 6543),
      // where settings made when connecting do not carry over.
      await client.query("set local statement_timeout='10s'");
      await client.query("set local idle_in_transaction_session_timeout='15s'");
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
      if (!devices.length || devices[0].paired === false)
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
      await client.query(
        `update devices set measurement_boot=$2,measurement_seq=$3,freshness_verified=$4,
        candidate_boundary=$5,candidate_count=$6,installed_audio_version=$7 where id=$1`,
        [
          d.id,
          d.measurement_boot ?? null,
          d.measurement_seq ?? null,
          d.freshness_verified ?? false,
          d.candidate_boundary ?? null,
          d.candidate_count ?? 0,
          d.installed_audio_version ?? null,
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
  async patientRow(id) {
    const { rows } = await this.pool.query('select * from patients where id=$1', [id]);
    return rows[0];
  }
  async owned(userId, patientId, fn) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query("set local statement_timeout='10s'");
      await client.query("set local idle_in_transaction_session_timeout='15s'");
      const { rows } = await client.query(
        'select p.* from patients p join caregiver_patients cp on cp.patient_id=p.id where p.id=$1 and cp.caregiver_id=$2 for update of p for share of cp',
        [patientId, userId],
      );
      if (!rows.length) throw Object.assign(new Error('Patient access denied'), { status: 403 });
      const result = await fn(client, rows[0]);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      if (error.code === '23505')
        error = Object.assign(new Error('Watch already paired to another patient'), {
          status: 409,
        });
      throw error;
    } finally {
      client.release();
    }
  }
  async editPatient(userId, id, fields) {
    return this.owned(
      userId,
      id,
      async (client) =>
        (
          await client.query(
            'update patients set display_name=$2,phone_number=$3,emergency_contact=$4 where id=$1 returning *',
            [id, fields.display_name, fields.phone_number, fields.emergency_contact],
          )
        ).rows[0],
    );
  }
  // watchUrl is the board's address when it was paired by address, so the backend
  // can call its alarm route; null for a watch paired by product ID and code.
  async pairProduct(userId, id, productId, watchUrl = null) {
    return this.owned(userId, id, async (client) => {
      const old = (await client.query('select * from devices where patient_id=$1 for update', [id]))
        .rows[0];
      if (old?.paired && old.product_id && old.product_id !== productId)
        throw Object.assign(new Error('Unpair the current watch first'), { status: 409 });
      if (old?.paired && old.product_id === productId && (old.watch_url ?? null) === watchUrl)
        return old;
      return (
        await client.query(
          `insert into devices(patient_id,product_id,paired,watch_url) values($1,$2,true,$3)
        on conflict(patient_id) do update set product_id=$2,paired=true,watch_url=$3,
        last_seen_at=null,last_position_at=null,last_lat=null,last_lng=null,distance_meters=null,
        boundary_state='unknown',connection_state='unknown',candidate_boundary=null,candidate_count=0,
        measurement_boot=null,measurement_seq=null,freshness_verified=false,installed_audio_version=null,
        applied_settings_version=0,paused_until=null,audio_silenced=false,alarm_active=false returning *`,
          [id, productId, watchUrl],
        )
      ).rows[0];
    });
  }
  async unpairProduct(userId, id) {
    return this.owned(userId, id, (client) =>
      client.query(
        'update devices set paired=false,product_id=null,watch_url=null where patient_id=$1',
        [id],
      ),
    );
  }
  async saveAudio(userId, id, audio) {
    return this.owned(userId, id, async (client, old) => {
      await client.query(
        'update patients set audio_storage_path=$2,audio_version=$3,audio_sha256=$4,audio_updated_at=now(),settings_version=settings_version+1 where id=$1',
        [id, audio.path, audio.version, audio.sha256],
      );
      return old.audio_storage_path;
    });
  }
  // A new patient belongs to the caregiver who created it. Home starts unset.
  async createPatient(userId, displayName) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query("set local statement_timeout='10s'");
      await client.query("set local idle_in_transaction_session_timeout='15s'");
      const { rows } = await client.query(
        'insert into patients(display_name, radius_meters) values($1, 100) returning *',
        [displayName],
      );
      await client.query(
        'insert into caregiver_patients(caregiver_id, patient_id) values($1, $2)',
        [userId, rows[0].id],
      );
      await client.query('commit');
      return rows[0];
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
      await client.query("set local statement_timeout='10s'");
      await client.query("set local idle_in_transaction_session_timeout='15s'");
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

const labels = {
  out_of_bounds: 'Watch is out of bounds',
  returned_inside: 'Watch returned inside the home radius',
  connection_lost: 'Watch connection lost',
  connection_restored: 'Watch connection restored',
};

function createPushWorker(pool, { fetchImpl = fetch, accessToken = '' } = {}) {
  async function post(path, body) {
    const response = await fetchImpl(`https://exp.host/--/api/v2/push/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Push service unavailable');
    const value = await response.json();
    if (value.errors) throw new Error('Push service rejected request');
    return value.data;
  }
  return async function deliver() {
    // Keep network calls outside the status transaction; a slow push service must
    // never delay a watch response or the five-second disconnection check.
    for (let count = 0; count < 20; count += 1) {
      const { rows } =
        await pool.query(`update notification_outbox set next_attempt_at=now()+interval '60 seconds'
        where id=(select id from notification_outbox where next_attempt_at<=now()
        order by created_at for update skip locked limit 1) returning *`);
      const job = rows[0];
      if (!job) return;
      const allowed = await pool.query(
        `select 1 from push_tokens pt join caregiver_patients cp using(caregiver_id)
        where pt.caregiver_id=$1 and pt.token=$2 and cp.patient_id=$3`,
        [job.caregiver_id, job.token, job.patient_id],
      );
      if (
        !allowed.rows.length ||
        Date.now() - new Date(job.created_at).getTime() > 3600000 ||
        job.attempts >= 8
      ) {
        await pool.query('delete from notification_outbox where id=$1', [job.id]);
        continue;
      }
      try {
        let result;
        if (job.ticket_id) {
          const receipts = await post('getReceipts', { ids: [job.ticket_id] });
          result = receipts?.[job.ticket_id];
          if (!result) {
            await pool.query(
              "update notification_outbox set next_attempt_at=now()+interval '1 minute' where id=$1",
              [job.id],
            );
            continue;
          }
        } else {
          [result] = await post('send', [
            {
              to: job.token,
              title: 'careQ',
              body: labels[job.event],
              sound: 'default',
              channelId: 'careq-alerts',
              data: { event: job.event, patient_id: job.patient_id, notification_id: job.id },
            },
          ]);
        }
        if (result?.status === 'ok') {
          if (job.ticket_id)
            await pool.query('delete from notification_outbox where id=$1', [job.id]);
          else {
            if (!result.id) throw new Error('Missing push ticket');
            await pool.query(
              "update notification_outbox set ticket_id=$2,next_attempt_at=now()+interval '15 minutes' where id=$1",
              [job.id, result.id],
            );
          }
        } else if (result?.details?.error === 'DeviceNotRegistered') {
          await pool.query('delete from push_tokens where caregiver_id=$1 and token=$2', [
            job.caregiver_id,
            job.token,
          ]);
          await pool.query('delete from notification_outbox where token=$1', [job.token]);
        } else {
          // A definite failed receipt may be retried as a new send. A network
          // failure while reading receipts must keep the existing ticket.
          if (job.ticket_id) job.ticket_id = null;
          throw new Error(result?.details?.error || 'Push rejected');
        }
      } catch {
        const seconds = Math.min(300, 5 * 2 ** job.attempts);
        await pool.query(
          `update notification_outbox set attempts=attempts+1,ticket_id=$3,last_error='Delivery failed',
          next_attempt_at=now()+($2 * interval '1 second') where id=$1`,
          [job.id, seconds, job.ticket_id],
        );
      }
    }
  };
}
module.exports = { createPushWorker };

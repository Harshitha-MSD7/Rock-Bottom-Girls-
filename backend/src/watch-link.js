// Calls from the backend to the careQ board. The board runs a small web server
// (careQ/app.py, port 5000) with GET /setup, GET /state, PATCH /state and
// GET /alert?active=true|false. Used for pairing by address and for switching
// the board's alarm on and off.

// Turn what a caregiver typed ("192.168.1.50" or "192.168.1.50:5000") into
// "http://192.168.1.50:5000". Returns null when it is not a usable address.
function normalizeWatchUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) return null;
  const text = value.trim();
  const hasScheme = text.includes('://');
  if (hasScheme && !/^https?:\/\//i.test(text)) return null;
  try {
    const url = new URL(hasScheme ? text : `http://${text}`);
    if (url.username || url.password) return null;
    // The board always listens on 5000, so a bare IP address is enough.
    if (!url.port && url.protocol === 'http:') url.port = '5000';
    return url.origin;
  } catch {
    return null;
  }
}

function createWatchLink({ fetchImpl = fetch, timeoutMs = 4000 } = {}) {
  async function call(base, path, options = {}) {
    const response = await fetchImpl(base + path, {
      ...options,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`${path} answered ${response.status}`);
    return response.json();
  }

  // Pairing handshake: confirms a careQ board is at this address and returns
  // the product ID it reports.
  async function setup(base) {
    const body = await call(base, '/setup');
    if (body?.product_id === undefined || body.product_id === null) {
      throw new Error('That address did not answer like a careQ watch');
    }
    return { product_id: String(body.product_id) };
  }

  async function setAlarm(base, on) {
    if (on) {
      try {
        await call(base, '/alert?active=true');
      } catch (error) {
        // The board answers 400 when its alarm is already on. That is the state
        // we want, so only fail if the alarm is really off.
        const state = await call(base, '/state');
        if (state?.alert !== true) throw error;
      }
      return;
    }
    // careQ/app.py currently refuses every /alert call while its alert flag is
    // set, including the one that turns it off. Clearing the flag first makes
    // the "off" call go through, and is harmless once that is changed.
    await call(base, '/state', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alert: false }),
    });
    await call(base, '/alert?active=false');
  }

  return { setup, setAlarm };
}

module.exports = { createWatchLink, normalizeWatchUrl };

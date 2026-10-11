// One process-wide serialized queue enforces the public provider's request limit.
// Run one backend instance with public Nominatim, or configure another provider.
function createGeocoder({
  fetchImpl = fetch,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  endpoint = 'https://nominatim.openstreetmap.org/search',
  userAgent = 'careQ-hackathon/1.0 (https://github.com/Harshitha-MSD7/Rock-Bottom-Girls-)',
} = {}) {
  const cache = new Map();
  let queue = Promise.resolve(),
    lastStarted = -Infinity,
    pending = 0;
  return async (address) => {
    const key = address.trim().toLowerCase();
    const cached = cache.get(key);
    if (cached && now() - cached.at < 86400000) return cached.value;
    if (pending >= 10)
      throw Object.assign(new Error('Address lookup busy. Please try again shortly.'), {
        status: 429,
      });
    pending += 1;
    const work = queue.then(async () => {
      const secondLook = cache.get(key);
      if (secondLook && now() - secondLook.at < 86400000) return secondLook.value;
      await sleep(Math.max(0, 1100 - (now() - lastStarted)));
      lastStarted = now();
      const url = new URL(endpoint);
      url.searchParams.set('q', address);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('limit', '1');
      const response = await fetchImpl(url, {
        headers: { 'User-Agent': userAgent },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok)
        throw Object.assign(new Error('Address lookup unavailable'), { status: 503 });
      const [match] = await response.json();
      const value = match
        ? {
            lat: Number(match.lat),
            lng: Number(match.lon),
            address: String(match.display_name).slice(0, 300),
          }
        : null;
      if (
        value &&
        (!Number.isFinite(value.lat) ||
          Math.abs(value.lat) > 90 ||
          !Number.isFinite(value.lng) ||
          Math.abs(value.lng) > 180)
      )
        throw new Error('Invalid geocoding result');
      if (cache.size >= 500) cache.delete(cache.keys().next().value);
      cache.set(key, { value, at: now() });
      return value;
    });
    queue = work
      .catch(() => {})
      .finally(() => {
        pending -= 1;
      });
    return work;
  };
}
module.exports = { createGeocoder };

// Calls to the board, run against a stand-in for careQ/app.py.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWatchLink, normalizeWatchUrl } = require('../src/watch-link');

const BOARD = 'http://10.0.0.5:5000';

// Behaves like the board's Flask routes, including refusing /alert while alerting.
function fakeBoard() {
  const board = { state: { alert: false }, calls: [], online: true };
  board.fetch = async (url, options = {}) => {
    if (!board.online) throw new Error('connect ECONNREFUSED');
    const { pathname, search, searchParams } = new URL(url);
    const method = options.method ?? 'GET';
    board.calls.push(`${method} ${pathname}${search}`);
    const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
    if (pathname === '/setup') return reply(200, { product_id: '00000001', states: board.state });
    if (pathname === '/state' && method === 'PATCH') {
      Object.assign(board.state, JSON.parse(options.body));
      return reply(200, board.state);
    }
    if (pathname === '/state') return reply(200, { ...board.state });
    if (pathname === '/alert') {
      if (board.state.alert) return reply(400, { error: 'alert is already active' });
      board.state.alert = searchParams.get('active') === 'true';
      return reply(200, { status: 'alert enabled' });
    }
    return reply(404, {});
  };
  return board;
}

test('watch addresses are tidied, and unusable ones rejected', () => {
  assert.equal(normalizeWatchUrl(' 192.168.1.50 '), 'http://192.168.1.50:5000');
  assert.equal(normalizeWatchUrl('192.168.1.50:5001'), 'http://192.168.1.50:5001');
  assert.equal(normalizeWatchUrl('http://watch.local:5000/setup'), 'http://watch.local:5000');
  for (const bad of ['', 'ftp://x', 'http://user:pw@host', 'not an address !!', 42, null]) {
    assert.equal(normalizeWatchUrl(bad), null);
  }
});

test('pairing handshake returns the product ID the board reports', async () => {
  const board = fakeBoard();
  const link = createWatchLink({ fetchImpl: board.fetch });
  assert.deepEqual(await link.setup(BOARD), { product_id: '00000001' });
  board.online = false;
  await assert.rejects(link.setup(BOARD));
});

test('alarm on, on again, then off, despite the board refusing /alert while alerting', async () => {
  const board = fakeBoard();
  const link = createWatchLink({ fetchImpl: board.fetch });

  await link.setAlarm(BOARD, true);
  assert.equal(board.state.alert, true);

  // Already on: the board answers 400, which is still the wanted state.
  await link.setAlarm(BOARD, true);
  assert.equal(board.state.alert, true);

  await link.setAlarm(BOARD, false);
  assert.equal(board.state.alert, false);
});

test('an unreachable board is reported as a failure', async () => {
  const board = fakeBoard();
  board.online = false;
  const link = createWatchLink({ fetchImpl: board.fetch });
  await assert.rejects(link.setAlarm(BOARD, true));
  await assert.rejects(link.setAlarm(BOARD, false));
});

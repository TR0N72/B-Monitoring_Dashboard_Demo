const mockExecute = jest.fn();
jest.mock('../config/db', () => ({ getPool: () => ({ execute: mockExecute }) }));

let tq;
const tgReply = (map) => jest.fn(async (url, opts) => {
  const r = map[JSON.parse(opts.body).chat_id];
  return { status: r.status || 200, json: async () => r.body };
});
const OK = { body: { ok: true } };
const BAD = { status: 403, body: { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' } };
const sqls = (re) => mockExecute.mock.calls.filter((c) => re.test(c[0]));
const tick = () => jest.advanceTimersByTimeAsync(1200);

// workers query -> chats[0], admins query -> chats[1..]
function setup(chats, replies) {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  global.fetch = tgReply(replies);
  mockExecute.mockImplementation(async (sql) => {
    if (/FROM devices d/.test(sql)) return [[{ kontak_telegram: chats[0] }]];
    if (/FROM users/.test(sql)) return [chats.slice(1).map((c) => ({ kontak_telegram: c }))];
    return [{ affectedRows: 1 }];
  });
  tq = require('../config/telegramQueue');
}
const alert = { parameter: 'suhu', measured_value: 40, level_peringatan: 'critical', pesan_notifikasi: 'x', node_id: 'N1' };
const send = (parameter = 'suhu') => tq.enqueue({ priority: tq.PRIORITY.WARNING, deviceId: 7, alertData: { ...alert, parameter } });

beforeEach(() => {
  jest.useFakeTimers();
  jest.resetModules();
  mockExecute.mockReset();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

test('1 penerima invalid -> DLQ (dead), bukan DELETE; dead_since_start=1', async () => {
  setup(['111'], { 111: BAD });
  send();
  await tick();
  const dead = sqls(/SET status='dead'/);
  expect(dead).toHaveLength(1);
  expect(dead[0][1][0]).toContain('111');
  expect(sqls(/DELETE FROM telegram_queue/)).toHaveLength(0);
  expect(tq.getQueueStatus().total).toBe(0);
  expect(tq.getQueueStatus().dead_since_start).toBe(1);
});

test('1 ok + 1 invalid -> DELETE, tanpa dead, error log menyebut chat invalid', async () => {
  setup(['111', '222'], { 111: OK, 222: BAD });
  send();
  await tick();
  expect(sqls(/DELETE FROM telegram_queue/)).toHaveLength(1);
  expect(sqls(/SET status='dead'/)).toHaveLength(0);
  expect(console.error.mock.calls.flat().join(' ')).toContain('222');
  expect(tq.getQueueStatus().dead_since_start).toBe(0);
});

test('semua ok -> DELETE, dead_since_start tetap 0', async () => {
  setup(['111', '222'], { 111: OK, 222: OK });
  send();
  await tick();
  expect(sqls(/DELETE FROM telegram_queue/)).toHaveLength(1);
  expect(sqls(/SET status='dead'/)).toHaveLength(0);
  expect(tq.getQueueStatus().dead_since_start).toBe(0);
});

test('invalid -> cache routing dibuang: kirim berikutnya resolve ulang dari DB', async () => {
  setup(['111'], { 111: BAD });
  send();
  await tick();
  expect(sqls(/FROM devices d/)).toHaveLength(1);
  send('salinitas');
  await tick();
  expect(sqls(/FROM devices d/)).toHaveLength(2);
});

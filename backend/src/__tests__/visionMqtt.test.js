'use strict';
// Handler topik tambak/+/vision: kondisi -> label, kelas -> hsv_metadata.predicted_class.
process.env.JWT_SECRET = 'bmonitor_dev_secret';
const mockQuery = jest.fn();
jest.mock('../config/db', () => ({ getPool: jest.fn(() => ({ query: mockQuery })) }));
jest.mock('../socket/alerts', () => ({ getIo: () => null }));
const { saveDetection } = require('../services/aiDetection');

beforeEach(() => mockQuery.mockReset());

test('vision payload from hardware is stored with class and label', async () => {
  mockQuery.mockResolvedValueOnce([[{ id: 18, node_id: 'N1' }]]).mockResolvedValueOnce([{ insertId: 7 }]);
  const r = await saveDetection({ node_id: 'N1', label: 'Caution', confidence: 0.9149,
    model_version: 'hw-vision', hsv_metadata: { predicted_class: 'Class 4', source: 'mqtt' } });
  expect(r).toMatchObject({ id: 7, label: 'Caution', confidence: 0.9149, model_version: 'hw-vision' });
  expect(JSON.parse(mockQuery.mock.calls[1][1][7])).toMatchObject({ predicted_class: 'Class 4' });
});

test('unknown label rejected, unknown node rejected', async () => {
  await expect(saveDetection({ node_id: 'N1', label: 'Class 4', confidence: 0.9 })).rejects.toMatchObject({ status: 400 });
  mockQuery.mockResolvedValueOnce([[]]);
  await expect(saveDetection({ node_id: 'N9', label: 'Normal', confidence: 0.9 })).rejects.toMatchObject({ status: 404 });
});

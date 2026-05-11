const express = require('express');
const { getInfluxQueryApi, influxBucket } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const router = express.Router();
router.use(authenticate);
router.get('/latest', async (req, res) => {
  try {
    const { device_id } = req.query;
    const queryApi = getInfluxQueryApi();
    const deviceFilter = device_id
      ? `|> filter(fn: (r) => r["device_id"] == "${device_id}")`
      : '';
    const fluxQuery = `
      from(bucket: "${influxBucket}")
        |> range(start: -1h)
        ${deviceFilter}
        |> filter(fn: (r) => r["_measurement"] == "water_quality")
        |> last()
        |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
    `;
    const results = [];
    await new Promise((resolve, reject) => {
      queryApi.queryRows(fluxQuery, {
        next(row, tableMeta) {
          results.push(tableMeta.toObject(row));
        },
        error(err) {
          reject(err);
        },
        complete() {
          resolve();
        },
      });
    });
    res.json({ readings: results });
  } catch (err) {
    if (err.message && err.message.includes('ECONNREFUSED')) {
      return res.json({ readings: [], warning: 'InfluxDB not available' });
    }
    console.error('[SENSORS] Latest error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});
router.get('/history', async (req, res) => {
  try {
    const {
      device_id,
      parameter,
      range: timeRange = '24h',
      interval = '5m',
    } = req.query;
    const queryApi = getInfluxQueryApi();
    const deviceFilter = device_id
      ? `|> filter(fn: (r) => r["device_id"] == "${device_id}")`
      : '';
    const paramFilter = parameter
      ? `|> filter(fn: (r) => r["_field"] == "${parameter}")`
      : '';
    const fluxQuery = `
      from(bucket: "${influxBucket}")
        |> range(start: -${timeRange})
        |> filter(fn: (r) => r["_measurement"] == "water_quality")
        ${deviceFilter}
        ${paramFilter}
        |> aggregateWindow(every: ${interval}, fn: mean, createEmpty: false)
        |> yield(name: "mean")
    `;
    const results = [];
    await new Promise((resolve, reject) => {
      queryApi.queryRows(fluxQuery, {
        next(row, tableMeta) {
          results.push(tableMeta.toObject(row));
        },
        error(err) {
          reject(err);
        },
        complete() {
          resolve();
        },
      });
    });
    res.json({
      data: results,
      query: { device_id, parameter, range: timeRange, interval },
    });
  } catch (err) {
    if (err.message && err.message.includes('ECONNREFUSED')) {
      return res.json({ data: [], warning: 'InfluxDB not available' });
    }
    console.error('[SENSORS] History error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});
module.exports = router;

'use strict';
/**
 * ai-detection.routes.js — API Routes untuk AI Visual Detection
 * ==============================================================
 * Endpoints:
 *   POST /api/ai-detection/infer   — Terima fitur visual, jalankan inferensi
 *                                    XGBoost Python, simpan hasil, dan kembalikan
 *                                    keputusan DSS terintegrasi.
 *   POST /api/ai-detection/        — Simpan hasil deteksi langsung (dari ESP32-CAM
 *                                    yang sudah menjalankan inferensi sendiri).
 *   GET  /api/ai-detection/        — Ambil riwayat deteksi visual dengan filter.
 *   GET  /api/ai-detection/health  — Health-check ketersediaan Python AI service.
 */

const express             = require('express');
const { getPool }         = require('../config/db');
const { authenticate }    = require('../middleware/auth');
const { runVisualInference, checkHealth } = require('../services/aiService');
const { processFuzzy }    = require('../services/fuzzyDSS');

const router = express.Router();
router.use(authenticate);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai-detection/infer
// Terima fitur numerik visual dari ESP32-CAM, jalankan inferensi XGBoost Python,
// integrasikan hasil ke DSS Fuzzy, dan simpan ke ai_detection_logs.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/infer', async (req, res) => {
  try {
    const {
      device_id,
      sensor_data_id,
      image_path,
      features,    // { mean_h, mean_s, mean_v, green_ratio, edge_density, intensity_variance }
      // Opsional: nilai sensor fisik untuk DSS terintegrasi
      suhu,
      salinitas,
    } = req.body;

    // ── Validasi input dasar ─────────────────────────────────────────────────
    if (!device_id) {
      return res.status(400).json({ error: 'device_id is required' });
    }
    if (!features || typeof features !== 'object') {
      return res.status(400).json({ error: 'features object is required (mean_h, mean_s, mean_v, green_ratio, edge_density, intensity_variance)' });
    }

    const REQUIRED_FEATURES = ['mean_h', 'mean_s', 'mean_v', 'green_ratio', 'edge_density', 'intensity_variance'];
    const missingFeatures   = REQUIRED_FEATURES.filter(f => features[f] === undefined);
    if (missingFeatures.length > 0) {
      return res.status(400).json({ error: `Missing feature fields: ${missingFeatures.join(', ')}` });
    }

    // ── Resolve device ────────────────────────────────────────────────────────
    const pool = getPool();
    let getDeviceQuery  = 'SELECT id, node_id FROM devices WHERE node_id = ?';
    let getDeviceParams = [String(device_id)];
    if (!isNaN(device_id)) {
      getDeviceQuery  += ' OR id = ?';
      getDeviceParams.push(Number(device_id));
    }
    const [devices] = await pool.execute(getDeviceQuery, getDeviceParams);
    if (devices.length === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }
    const internalId = devices[0].id;
    const nodeId     = devices[0].node_id;

    // ── Jalankan inferensi XGBoost Python ────────────────────────────────────
    let aiResult;
    try {
      aiResult = await runVisualInference(features);
    } catch (aiErr) {
      console.error('[AI Route /infer] Inference failed:', aiErr.message);
      return res.status(503).json({
        error        : 'AI inference service unavailable',
        detail       : aiErr.message,
        suggestion   : 'Ensure Python is installed and model.joblib exists in backend/ai_service/',
      });
    }

    const { label, label_id, confidence, probabilities, model_version } = aiResult;

    // ── Bangun HSV metadata untuk penyimpanan ─────────────────────────────────
    const hsvMetadata = {
      ...features,
      label_id,
      probabilities,
    };

    // ── Simpan ke ai_detection_logs ───────────────────────────────────────────
    const [insertResult] = await pool.execute(
      `INSERT INTO ai_detection_logs
         (device_id, sensor_data_id, image_path, detection_type, label, confidence, model_version, hsv_metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        internalId,
        sensor_data_id || null,
        image_path     || null,
        'visual_classification',
        label,
        confidence,
        model_version,
        JSON.stringify(hsvMetadata),
      ]
    );
    const detectionId = insertResult.insertId;

    // ── Jalankan DSS Fuzzy terintegrasi dengan label visual ──────────────────
    let dssResult = null;
    if (suhu !== undefined && salinitas !== undefined) {
      try {
        dssResult = processFuzzy(parseFloat(suhu), parseFloat(salinitas), label);

        if (sensor_data_id) {
          await pool.execute(
            `INSERT INTO fuzzy_decisions
               (device_id, sensor_data_id, suhu_membership, salinitas_membership,
                visual_label, dss_score, dss_recommendation, fired_rules)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              internalId,
              sensor_data_id,
              dssResult.suhu_membership,
              dssResult.salinitas_membership,
              dssResult.visual_label,
              dssResult.score,
              dssResult.recommendation,
              JSON.stringify(dssResult.fired_rules),
            ]
          );
        }
      } catch (dssErr) {
        console.warn('[AI Route /infer] DSS computation warning:', dssErr.message);
      }
    }

    // ── Emisi WebSocket ───────────────────────────────────────────────────────
    const { getIo } = require('../socket/alerts');
    const io = getIo();
    if (io) {
      io.emit('ai:detection', {
        id           : detectionId,
        device_id    : internalId,
        node_id      : nodeId,
        label,
        confidence,
        probabilities,
        dss          : dssResult,
        created_at   : new Date(),
      });
    }

    // ── Response ──────────────────────────────────────────────────────────────
    return res.status(201).json({
      message        : 'Visual inference completed and saved.',
      id             : detectionId,
      ai_result      : {
        label,
        label_id,
        confidence,
        probabilities,
        model_version,
      },
      dss_result     : dssResult,
    });

  } catch (err) {
    console.error('[AI Route /infer] Unexpected error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ai-detection/health
// Health check — periksa ketersediaan Python dan model XGBoost.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/health', async (req, res) => {
  const health = await checkHealth();
  const status = health.available ? 200 : 503;
  return res.status(status).json({
    service      : 'xgboost-ai-inference',
    ...health,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ai-detection/
// Simpan hasil deteksi langsung (tanpa inferensi ulang).
// Digunakan jika ESP32-CAM sudah melakukan inferensi di edge.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { device_id, sensor_data_id, label, confidence, model_version, hsv_metadata, image_path } = req.body;

    if (!device_id) {
      return res.status(400).json({ error: 'device_id is required' });
    }

    const pool = getPool();
    let getDeviceQuery  = 'SELECT id FROM devices WHERE node_id = ?';
    let getDeviceParams = [String(device_id)];
    if (!isNaN(device_id)) {
      getDeviceQuery  += ' OR id = ?';
      getDeviceParams.push(Number(device_id));
    }
    const [devices] = await pool.execute(getDeviceQuery, getDeviceParams);
    if (devices.length === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }
    const internalId = devices[0].id;

    const [result] = await pool.execute(
      `INSERT INTO ai_detection_logs
         (device_id, sensor_data_id, image_path, label, confidence, model_version, hsv_metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [internalId, sensor_data_id || null, image_path || null, label, confidence, model_version, JSON.stringify(hsv_metadata || {})]
    );

    const { getIo } = require('../socket/alerts');
    const io = getIo();
    if (io) {
      io.emit('ai:detection', {
        id        : result.insertId,
        device_id : internalId,
        label,
        confidence,
        created_at: new Date(),
      });
    }

    return res.status(201).json({ message: 'AI detection saved successfully', id: result.insertId });
  } catch (err) {
    console.error('[AI] Post error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ai-detection/
// Ambil riwayat deteksi visual dengan filter (device, label, rentang waktu).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { device_id, start_date, end_date, label, page = 1, limit = 50 } = req.query;
    const offset    = (Math.max(1, parseInt(page, 10)) - 1) * Math.min(100, parseInt(limit, 10));
    const pageLimit = Math.min(100, parseInt(limit, 10));

    let query = `
      SELECT
        a.id, a.device_id, a.sensor_data_id, a.image_path, a.detection_type,
        a.label, a.confidence, a.model_version, a.hsv_metadata, a.created_at,
        d.node_id, d.name AS device_name
      FROM ai_detection_logs a
      JOIN devices d ON a.device_id = d.id
      WHERE 1=1
    `;
    const params = [];

    if (device_id) {
      if (!isNaN(device_id)) {
        query += ` AND (d.node_id = ? OR d.id = ?)`;
        params.push(String(device_id), Number(device_id));
      } else {
        query += ` AND d.node_id = ?`;
        params.push(device_id);
      }
    }
    if (label) {
      query += ` AND a.label = ?`;
      params.push(label);
    }
    if (start_date) {
      query += ` AND a.created_at >= ?`;
      params.push(start_date);
    }
    if (end_date) {
      query += ` AND a.created_at <= ?`;
      params.push(end_date);
    }

    query += ` ORDER BY a.created_at DESC LIMIT ? OFFSET ?`;
    params.push(String(pageLimit), String(offset));

    const pool     = getPool();
    const [rows]   = await pool.execute(query, params);

    // Parse hsv_metadata JSON jika masih string
    const data = rows.map(row => ({
      ...row,
      hsv_metadata: typeof row.hsv_metadata === 'string'
        ? JSON.parse(row.hsv_metadata)
        : row.hsv_metadata,
    }));

    return res.json({ data, pagination: { page: parseInt(page, 10), limit: pageLimit } });
  } catch (err) {
    console.error('[AI] Get history error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;

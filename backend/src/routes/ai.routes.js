'use strict';

const express = require('express');
const { getPool } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

const { saveDetection, normalizeLabel } = require('../services/aiDetection');

/** POST /api/ai/detections — simpan hasil inferensi visual (JWT wajib) */
router.post('/detections', authenticate, async (req, res) => {
  try {
    const data = await saveDetection(req.body);
    return res.status(201).json({ message: 'AI detection processed successfully', data });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[AI] save error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

/**
 * GET /api/ai/detections — LORA-12: getAIDetectionHistory
 * Riwayat deteksi AI dengan filter, ringkasan metrik, dan pagination
 */
router.get('/detections', authenticate, async (req, res) => {
  try {
    const {
      device_id,
      label,
      start_date,
      end_date,
      limit = 50,
      page = 1,
    } = req.query;

    const pageLimit = Math.min(Math.max(1, parseInt(limit, 10) || 50), 200);
    const pageOffset = Math.max(0, ((parseInt(page, 10) || 1) - 1) * pageLimit);

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (device_id) {
      if (!isNaN(device_id)) {
        whereClause += ' AND (d.node_id = ? OR d.id = ?)';
        params.push(String(device_id), Number(device_id));
      } else {
        whereClause += ' AND d.node_id = ?';
        params.push(device_id);
      }
    }

    if (label) {
      whereClause += ' AND a.label = ?';
      params.push(normalizeLabel(label) || '');
    }

    if (start_date) {
      whereClause += ' AND a.created_at >= ?';
      params.push(start_date);
    }
    if (end_date) {
      whereClause += ' AND a.created_at <= ?';
      params.push(end_date);
    }

    const pool = getPool();

    // Query data
    const query = `
      SELECT
        a.id, a.device_id, a.sensor_data_id, a.image_path,
        a.detection_type, a.label, a.confidence, a.model_version,
        a.hsv_metadata, a.created_at,
        d.node_id, d.name AS device_name
      FROM ai_detection_logs a
      JOIN devices d ON a.device_id = d.id
      ${whereClause}
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const countQuery = `
      SELECT
        COUNT(*) AS total_count,
        SUM(CASE WHEN a.label = 'Normal' THEN 1 ELSE 0 END) AS normal_count,
        SUM(CASE WHEN a.label = 'Caution' THEN 1 ELSE 0 END) AS caution_count,
        SUM(CASE WHEN a.label = 'Warning' THEN 1 ELSE 0 END) AS warning_count,
        AVG(a.confidence) AS avg_confidence
      FROM ai_detection_logs a
      JOIN devices d ON a.device_id = d.id
      ${whereClause}
    `;

    const [rows] = await pool.query(query, [...params, pageLimit, pageOffset]);
    const [counts] = await pool.query(countQuery, params);

    const countRow = counts[0] || {};
    const total = Number(countRow.total_count || 0);

    const data = rows.map(r => ({
      ...r,
      hsv_metadata: typeof r.hsv_metadata === 'string'
        ? JSON.parse(r.hsv_metadata)
        : r.hsv_metadata,
    }));

    return res.json({
      data,
      summary: {
        total,
        normal: Number(countRow.normal_count || 0),
        caution: Number(countRow.caution_count || 0),
        warning: Number(countRow.warning_count || 0),
        avg_confidence: countRow.avg_confidence ? parseFloat(Number(countRow.avg_confidence).toFixed(3)) : 0,
      },
      pagination: {
        page: parseInt(page, 10) || 1,
        limit: pageLimit,
        total,
        total_pages: Math.ceil(total / pageLimit) || 1,
      },
    });
  } catch (err) {
    console.error('[AI] getAIDetectionHistory error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

/**
 * POST /api/ai/capture — LORA-13: captureAndAnalyze
 * Mentriggerr ESP32-CAM via MQTT topik tambak/{node_id}/camera/capture
 */
router.post('/capture', authenticate, async (req, res) => {
  try {
    const { node_id } = req.body;
    const targetNode = node_id || 'ESP32-NODE-01';

    const requestId = `cap_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
    const captureTopic = `tambak/${targetNode}/camera/capture`;
    const payload = {
      request_id: requestId,
      node_id: targetNode,
      timestamp: new Date().toISOString(),
      action: 'capture_and_analyze',
      requested_by: req.user?.username || 'operator',
    };

    let published = false;
    try {
      const { publishMQTT } = require('../config/mqtt');
      publishMQTT(captureTopic, payload, { qos: 1 });
      published = true;
    } catch (mqttErr) {
      console.warn('[AI] Capture MQTT publish warning:', mqttErr.message);
    }

    return res.status(202).json({
      message: 'Capture and analysis command dispatched to camera node',
      request_id: requestId,
      node_id: targetNode,
      topic: captureTopic,
      mqtt_dispatched: published,
      timestamp: payload.timestamp,
    });
  } catch (err) {
    console.error('[AI] captureAndAnalyze error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;

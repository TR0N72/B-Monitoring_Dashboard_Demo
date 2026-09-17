'use strict';
/**
 * fuzzy.routes.js — API Routes untuk Fuzzy DSS Log & Konfigurasi
 * ==============================================================
 * Endpoints:
 *   GET  /api/dss/          — Riwayat keputusan Fuzzy DSS dengan filter
 *   GET  /api/dss/rules     — Daftar lengkap 27 aturan IF-THEN (untuk UI konfigurasi)
 *   POST /api/dss/simulate  — Simulasi DSS Fuzzy dengan nilai input manual
 */

const express              = require('express');
const { getPool }          = require('../config/db');
const { authenticate }     = require('../middleware/auth');
const { processFuzzy, getRuleDefinitions } = require('../services/fuzzyDSS');

const router = express.Router();
router.use(authenticate);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/dss/rules
// Kembalikan definisi lengkap 27 aturan Fuzzy IF-THEN untuk keperluan UI
// halaman Admin Configuration (Fuzzy Logic Rule Editor).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/rules', (req, res) => {
  try {
    const rules = getRuleDefinitions();
    return res.json({
      total: rules.length,
      membership_functions: {
        suhu: {
          description: 'Fungsi keanggotaan Suhu Air (°C) — Tambak Bandeng Juwana',
          sets: [
            { name: 'Rendah',  type: 'trapezoidal', params: [-Infinity, 24, 26, 28] },
            { name: 'Normal',  type: 'triangular',  params: [26, 29, 32] },
            { name: 'Tinggi',  type: 'trapezoidal', params: [30, 32, Infinity, Infinity] },
          ],
          optimal_range: { min: 28, max: 30, unit: '°C' },
        },
        salinitas: {
          description: 'Fungsi keanggotaan Salinitas (ppt) — Tambak Bandeng Juwana',
          sets: [
            { name: 'Rendah',  type: 'trapezoidal', params: [-Infinity, 8, 12, 15] },
            { name: 'Normal',  type: 'trapezoidal', params: [12, 17, 22, 28] },
            { name: 'Tinggi',  type: 'trapezoidal', params: [25, 32, Infinity, Infinity] },
          ],
          optimal_range: { min: 15, max: 25, unit: 'ppt' },
        },
        visual: {
          description: 'Label visual dari model XGBoost (singleton membership)',
          sets: [
            { name: 'Normal',  description: 'Air jernih, kondisi optimal' },
            { name: 'Caution', description: 'Air mulai keruh, pantau lebih ketat' },
            { name: 'Warning', description: 'Air sangat keruh / bloom alga' },
          ],
        },
        output: {
          description: 'DSS Score output (0–100)',
          classes: [
            { name: 'Aman',    range: [0, 35],   centroid: 20 },
            { name: 'Waspada', range: [36, 65],  centroid: 50 },
            { name: 'Bahaya',  range: [66, 100], centroid: 80 },
          ],
        },
      },
      rules,
    });
  } catch (err) {
    console.error('[DSS] Get rules error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/dss/simulate
// Simulasi DSS Fuzzy dengan nilai input manual (untuk halaman konfigurasi).
// Tidak menyimpan ke database.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/simulate', (req, res) => {
  try {
    const { suhu, salinitas } = req.body;

    if (suhu === undefined || salinitas === undefined) {
      return res.status(400).json({ error: 'suhu and salinitas are required.' });
    }

    const suhuVal = parseFloat(suhu);
    const salVal  = parseFloat(salinitas);

    if (isNaN(suhuVal) || isNaN(salVal)) {
      return res.status(400).json({ error: 'suhu and salinitas must be valid numbers.' });
    }

    const result = processFuzzy(suhuVal, salVal);

    return res.json({
      simulation: true,
      inputs: { suhu: suhuVal, salinitas: salVal },
      ...result,
    });
  } catch (err) {
    console.error('[DSS] Simulate error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/dss/
// Riwayat keputusan DSS Fuzzy dengan filter (device, rentang waktu, paginasi).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { device_id, start_date, end_date, page = 1, limit = 50 } = req.query;
    const offset    = (Math.max(1, parseInt(page, 10)) - 1) * Math.min(100, parseInt(limit, 10));
    const pageLimit = Math.min(100, parseInt(limit, 10));

    let query = `
      SELECT
        f.id, f.device_id, f.sensor_data_id,
        f.suhu_membership, f.salinitas_membership, f.visual_label,
        f.dss_score, f.dss_recommendation, f.fired_rules, f.created_at,
        d.node_id, d.name AS device_name
      FROM fuzzy_decisions f
      JOIN devices d ON f.device_id = d.id
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
    if (start_date) {
      query += ` AND f.created_at >= ?`;
      params.push(start_date);
    }
    if (end_date) {
      query += ` AND f.created_at <= ?`;
      params.push(end_date);
    }

    query += ` ORDER BY f.created_at DESC LIMIT ? OFFSET ?`;
    params.push(String(pageLimit), String(offset));

    const pool   = getPool();
    const [rows] = await pool.execute(query, params);

    // Parse fired_rules JSON jika masih string
    const data = rows.map(row => ({
      ...row,
      fired_rules: typeof row.fired_rules === 'string'
        ? JSON.parse(row.fired_rules)
        : row.fired_rules,
    }));

    return res.json({ data, pagination: { page: parseInt(page, 10), limit: pageLimit } });
  } catch (err) {
    console.error('[DSS] Get history error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;

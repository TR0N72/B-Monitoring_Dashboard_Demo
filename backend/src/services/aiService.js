'use strict';
/**
 * aiService.js — Node.js Bridge ke Python XGBoost Microservice
 * =============================================================
 * Modul ini menjembatani backend Node.js dengan script inferensi Python
 * melalui child_process.spawn. Komunikasi menggunakan stdio JSON per baris.
 *
 * Dua mode operasi tersedia:
 *   1. ONE_SHOT   (default) — Spawn process baru per request (sederhana, aman)
 *   2. PERSISTENT — Satu Python process yang tetap hidup, dibagi antar request
 *                   (lebih cepat, diaktifkan via AI_SERVICE_PERSISTENT=true)
 *
 * Penggunaan (dari route/handler):
 *   const { runVisualInference } = require('../services/aiService');
 *
 *   const result = await runVisualInference({
 *     mean_h          : 45.2,
 *     mean_s          : 120.5,
 *     mean_v          : 180.3,
 *     green_ratio     : 0.35,
 *     edge_density    : 0.08,
 *     intensity_variance: 22.4,
 *   });
 *   // result = { status, label, label_id, confidence, probabilities, model_version }
 */

const { spawn } = require('child_process');
const path      = require('path');
const os        = require('os');

// ── Configuration ──────────────────────────────────────────────────────────
const AI_SERVICE_DIR  = path.join(__dirname, '..', '..', 'ai_service');
const PREDICT_SCRIPT  = path.join(AI_SERVICE_DIR, 'predict.py');
const TIMEOUT_MS      = parseInt(process.env.AI_TIMEOUT_MS || '10000', 10);
const PERSISTENT_MODE = process.env.AI_SERVICE_PERSISTENT === 'true';
const PYTHON_CMD      = process.env.PYTHON_CMD || (os.platform() === 'win32' ? 'python' : 'python3');

// ── Persistent Process Pool (digunakan jika PERSISTENT_MODE = true) ────────
let _persistentProcess = null;
let _requestQueue      = [];    // Array of { resolve, reject, timer }
let _isRestarting      = false;

// ─────────────────────────────────────────────────────────────────────────────
// One-Shot Inference (default)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Jalankan inferensi dalam mode one-shot (spawn process baru tiap request).
 * @param {Object} features - Objek fitur visual (6 field).
 * @returns {Promise<Object>} Hasil inferensi dari Python.
 */
function _runOneShot(features) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`AI inference timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    const proc   = spawn(PYTHON_CMD, [PREDICT_SCRIPT], { cwd: AI_SERVICE_DIR });
    let stdout   = '';
    let stderr   = '';

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('error', (err) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(new Error(
          `Python executable not found: '${PYTHON_CMD}'. ` +
          `Set PYTHON_CMD env var or install Python.`
        ));
      } else {
        reject(new Error(`Failed to spawn AI process: ${err.message}`));
      }
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (stderr.trim()) {
        // Tulis pesan stderr Python sebagai diagnostik (bukan error fatal)
        const diagLines = stderr.trim().split('\n')
          .filter(l => !l.startsWith('[AI Service]')); // Filter log startup
        if (diagLines.length > 0) {
          console.warn('[aiService] Python stderr:', diagLines.join('\n'));
        }
      }

      if (!stdout.trim()) {
        return reject(new Error('AI service returned empty output.'));
      }

      try {
        const result = JSON.parse(stdout.trim());
        if (result.status === 'error') {
          return reject(new Error(`AI inference error: ${result.message}`));
        }
        resolve(result);
      } catch (parseErr) {
        reject(new Error(`Failed to parse AI output: ${stdout.trim()}`));
      }
    });

    // Kirim fitur sebagai JSON ke stdin Python lalu tutup
    proc.stdin.write(JSON.stringify(features) + '\n');
    proc.stdin.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistent Process (opsional — lebih efisien untuk throughput tinggi)
// ─────────────────────────────────────────────────────────────────────────────
function _startPersistentProcess() {
  if (_isRestarting) return;

  console.log('[aiService] Starting persistent Python AI process...');
  const proc  = spawn(PYTHON_CMD, [PREDICT_SCRIPT, '--persistent'], {
    cwd: AI_SERVICE_DIR,
  });

  let buffer = '';

  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    // Proses baris lengkap dari buffer
    const lines = buffer.split('\n');
    buffer = lines.pop(); // Simpan sisa yang belum lengkap

    for (const line of lines) {
      if (!line.trim()) continue;
      const pending = _requestQueue.shift();
      if (!pending) continue;

      clearTimeout(pending.timer);
      try {
        const result = JSON.parse(line);
        if (result.status === 'error') {
          pending.reject(new Error(`AI inference error: ${result.message}`));
        } else {
          pending.resolve(result);
        }
      } catch (e) {
        pending.reject(new Error(`Failed to parse AI output: ${line}`));
      }
    }
  });

  proc.stderr.on('data', (chunk) => {
    const msg = chunk.toString().trim();
    if (msg) console.log('[aiService][Python]', msg);
  });

  proc.on('error', (err) => {
    console.error('[aiService] Persistent process error:', err.message);
    _drainQueueWithError(err);
    _scheduleRestart();
  });

  proc.on('close', (code) => {
    if (_requestQueue.length > 0) {
      const err = new Error(`AI process exited unexpectedly (code ${code})`);
      _drainQueueWithError(err);
    }
    console.warn(`[aiService] Persistent process exited (code ${code}). Restarting...`);
    _scheduleRestart();
  });

  _persistentProcess = proc;
}

function _drainQueueWithError(err) {
  while (_requestQueue.length > 0) {
    const pending = _requestQueue.shift();
    clearTimeout(pending.timer);
    pending.reject(err);
  }
}

function _scheduleRestart(delayMs = 3000) {
  _isRestarting = true;
  _persistentProcess = null;
  setTimeout(() => {
    _isRestarting = false;
    _startPersistentProcess();
  }, delayMs);
}

function _runPersistent(features) {
  return new Promise((resolve, reject) => {
    if (!_persistentProcess || _persistentProcess.killed) {
      _startPersistentProcess();
    }

    const timer = setTimeout(() => {
      // Hapus dari queue jika masih ada
      const idx = _requestQueue.findIndex(q => q.resolve === resolve);
      if (idx !== -1) _requestQueue.splice(idx, 1);
      reject(new Error(`AI inference timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    _requestQueue.push({ resolve, reject, timer });
    _persistentProcess.stdin.write(JSON.stringify(features) + '\n');
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Jalankan inferensi visual XGBoost.
 * Secara otomatis memilih mode one-shot atau persistent berdasarkan
 * environment variable AI_SERVICE_PERSISTENT.
 *
 * @param {Object} features
 * @param {number} features.mean_h             - Rata-rata Hue (0-179)
 * @param {number} features.mean_s             - Rata-rata Saturation (0-255)
 * @param {number} features.mean_v             - Rata-rata Value (0-255)
 * @param {number} features.green_ratio        - Proporsi piksel hijau (0-1)
 * @param {number} features.edge_density       - Kepadatan tepi (0-1)
 * @param {number} features.intensity_variance - Variansi intensitas
 *
 * @returns {Promise<{status, label, label_id, confidence, probabilities, model_version}>}
 */
async function runVisualInference(features) {
  if (PERSISTENT_MODE) {
    return _runPersistent(features);
  }
  return _runOneShot(features);
}

/**
 * Periksa apakah Python dan model tersedia (untuk health check).
 * @returns {Promise<{available, version, error}>}
 */
async function checkHealth() {
  try {
    const testFeatures = {
      mean_h           : 85,
      mean_s           : 80,
      mean_v           : 160,
      green_ratio      : 0.40,
      edge_density     : 0.06,
      intensity_variance: 18,
    };
    const result = await _runOneShot(testFeatures);
    return {
      available    : true,
      model_version: result.model_version,
      error        : null,
    };
  } catch (err) {
    return {
      available    : false,
      model_version: null,
      error        : err.message,
    };
  }
}

// Inisialisasi persistent process jika mode diaktifkan
if (PERSISTENT_MODE) {
  _startPersistentProcess();
}

module.exports = {
  runVisualInference,
  checkHealth,
};

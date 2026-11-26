'use strict';

const db = require('../config/db');
const tq = require('../config/telegramQueue');
const { isEmergencyActive, markEngineStopSent, FAILSAFE_VERIFY_WINDOW_MS } = require('./emergencyState');

const ACTUATOR_ACTIONS = {
  OPEN_DRAIN_VALVE  : 'OPEN_DRAIN_VALVE',
  CLOSE_DRAIN_VALVE : 'CLOSE_DRAIN_VALVE',
  OPEN_FILL_VALVE   : 'OPEN_FILL_VALVE',
  CLOSE_FILL_VALVE  : 'CLOSE_FILL_VALVE',
  PUMP_ENGINE_START : 'PUMP_ENGINE_START',
  PUMP_ENGINE_STOP  : 'PUMP_ENGINE_STOP',
  EMERGENCY_STOP    : 'EMERGENCY_STOP',
  START_MEASURE     : 'START_MEASURE',
  FILL_AND_MEASURE  : 'FILL_AND_MEASURE',
  START_CYCLE       : 'START_CYCLE',
};

// 1-char gateway commands; actions omitted here carry no cmd field.
const ACTION_CMD = {
  OPEN_FILL_VALVE: 'f', OPEN_DRAIN_VALVE: 'k', START_MEASURE: 'm',
  FILL_AND_MEASURE: 'x', START_CYCLE: 'c', EMERGENCY_STOP: 's',
};

// Measurement-chamber nodes notify only on BAHAYA instead of triggering pond actuators.
const CHAMBER_NODES = (process.env.CHAMBER_NODES || 'N1').split(',').map(s => s.trim()).filter(Boolean);

const DSS_THRESHOLD_WASPADA = 36;
const DSS_THRESHOLD_BAHAYA  = 66;

const COOLDOWN_MS = parseInt(process.env.ACTUATOR_COOLDOWN_MS || '600000', 10);
const WASPADA_COOLDOWN_MS = 3 * 60 * 1000;
const SEQUENCE_STEP_DELAY_MS = parseInt(process.env.ACTUATOR_STEP_DELAY_MS || '30000', 10);

// Separate cooldown maps keep WASPADA alerts from blocking BAHAYA sequences.
const waspadaCooldowns = new Map();
const bahayaCooldowns = new Map();
const activeAbortControllers = new Map();

function isInBahayaCooldown(deviceId) {
  const last = bahayaCooldowns.get(deviceId);
  if (!last) return false;
  return (Date.now() - last) < COOLDOWN_MS;
}

function isInWaspadaCooldown(deviceId) {
  const last = waspadaCooldowns.get(deviceId);
  if (!last) return false;
  return (Date.now() - last) < WASPADA_COOLDOWN_MS;
}

function setBahayaCooldown(deviceId) {
  bahayaCooldowns.set(deviceId, Date.now());
}

function setWaspadaCooldown(deviceId) {
  waspadaCooldowns.set(deviceId, Date.now());
}

async function dispatchActuatorCommand({ mqttClient, deviceId, nodeId, aksi, triggerSource, triggerDetail }) {
  const pool = db.getPool();

  const [result] = await pool.execute(
    `INSERT INTO actuator_logs (device_id, aksi, trigger_source, trigger_detail, status)
     VALUES (?, ?, ?, ?, ?)`,
    [deviceId, aksi, triggerSource, triggerDetail, 'pending']
  );
  const commandId = result.insertId;

  if (mqttClient && mqttClient.connected) {
    mqttClient.publish(
      `tambak/${nodeId}/actuator/command`,
      JSON.stringify({ aksi, cmd: ACTION_CMD[aksi], command_id: commandId }),
      { qos: 1 }
    );
    console.log(`[AutoActuator] ✓ Sent ${aksi} → ${nodeId} (cmd_id: ${commandId})`);
  } else {
    console.warn(`[AutoActuator] ⚠ MQTT not connected — command ${aksi} logged but NOT sent`);
    await pool.execute(
      'UPDATE actuator_logs SET status = ? WHERE id = ?',
      ['mqtt_offline', commandId]
    );
  }

  return commandId;
}

async function executeSequence(steps, baseOpts) {
  const { onStepDispatched, signal, ...dispatchOpts } = baseOpts;
  for (let i = 0; i < steps.length; i++) {
    if (signal && signal.aborted) {
      console.warn(`[AutoActuator] ⛔ Sequence aborted at step ${i + 1} (${steps[i].aksi}) for device ${dispatchOpts.deviceId}`);
      break;
    }

    const step = steps[i];
    let commandId;
    try {
      commandId = await dispatchActuatorCommand({
        ...dispatchOpts,
        aksi          : step.aksi,
        triggerDetail : step.detail || dispatchOpts.triggerDetail,
      });
      if (onStepDispatched) onStepDispatched(step.aksi, commandId);
    } catch (err) {
      console.error(`[AutoActuator] Sequence step ${i + 1} (${step.aksi}) failed:`, err.message);
    }

    if (i < steps.length - 1 && step.delayAfterMs > 0) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, step.delayAfterMs);
        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve();
          }, { once: true });
        }
      });
    }
  }
}

function abortSequence(deviceId) {
  const ctrl = activeAbortControllers.get(deviceId);
  if (ctrl) {
    ctrl.abort();
    activeAbortControllers.delete(deviceId);
    console.warn(`[AutoActuator] ⛔ Sequence for device ${deviceId} forcibly aborted (EMERGENCY_STOP)`);
  }
}

async function evaluateAndActuate({ mqttClient, deviceId, nodeId, fuzzyResult, readings, io }) {
  const score          = fuzzyResult.score;
  const recommendation = fuzzyResult.recommendation;

  if (score < DSS_THRESHOLD_WASPADA) {
    // Do not reset cooldown on normal readings to avoid alert flapping near the threshold.
    return;
  }

  if (score >= DSS_THRESHOLD_WASPADA && score < DSS_THRESHOLD_BAHAYA) {
    if (!isInWaspadaCooldown(deviceId)) {
      setWaspadaCooldown(deviceId);
      console.log(`[AutoActuator] WASPADA on ${nodeId} (score: ${score}) — notifying only`);

      tq.sendDssAlert({
        deviceId,
        nodeId,
        dssScore      : score,
        recommendation,
        readings,
        level         : 'waspada',
      });

      if (io) {
        io.emit('system:status', {
          device_id     : deviceId,
          node_id       : nodeId,
          level         : 'waspada',
          dss_score     : score,
          recommendation,
          message       : `Status WASPADA pada node ${nodeId}. DSS Score: ${score}/100.`,
          timestamp     : new Date(),
        });
      }
    }
    return;
  }

  if (score >= DSS_THRESHOLD_BAHAYA) {
    if (isInBahayaCooldown(deviceId)) {
      console.log(`[AutoActuator] BAHAYA on ${nodeId} — skipping (in cooldown)`);
      return;
    }

    if (CHAMBER_NODES.includes(nodeId)) {
      setBahayaCooldown(deviceId);
      console.log(`[AutoActuator] BAHAYA on ${nodeId} (score: ${score}) — chamber node, notifying only`);
      if (io) {
        io.emit('system:status', {
          device_id: deviceId, node_id: nodeId, level: 'bahaya', dss_score: score,
          recommendation, auto_action: false, timestamp: new Date(),
          message: `Kondisi BAHAYA pada node ${nodeId}. DSS Score: ${score}/100. Tidak ada aksi otomatis.`,
        });
      }
      tq.sendDssAlert({ deviceId, nodeId, dssScore: score, recommendation, readings, level: 'bahaya' });
      return;
    }

    if (isEmergencyActive(deviceId)) {
      console.warn(`[AutoActuator] ⛔ BAHAYA on ${nodeId} — sequence BLOCKED (emergency state active). Manual reset required.`);
      return;
    }

    setBahayaCooldown(deviceId);

    const triggerDetail = `Auto trigger: DSS Score=${score}, Suhu=${readings.suhu}°C, Salinitas=${readings.salinitas}ppt, Rekomendasi=${recommendation}`;
    console.log(`[AutoActuator] 🚨 BAHAYA on ${nodeId} — executing closed-loop sequence`);

    if (io) {
      io.emit('system:status', {
        device_id  : deviceId,
        node_id    : nodeId,
        level      : 'bahaya',
        dss_score  : score,
        recommendation,
        message    : `Kondisi BAHAYA terdeteksi. Sistem mengaktifkan protokol darurat otomatis.`,
        timestamp  : new Date(),
        auto_action: true,
      });
    }

    // Safety interlock order: stop diesel pump and verify SW-420 before opening drain or fill valves.
    const sequence = [
      {
        aksi        : ACTUATOR_ACTIONS.PUMP_ENGINE_STOP,
        detail      : `${triggerDetail} | Langkah 1: Hentikan pompa diesel (sebelum buka katup)`,
        delayAfterMs: FAILSAFE_VERIFY_WINDOW_MS,
      },
      {
        aksi        : ACTUATOR_ACTIONS.OPEN_DRAIN_VALVE,
        detail      : `${triggerDetail} | Langkah 2: Buka katup kuras`,
        delayAfterMs: SEQUENCE_STEP_DELAY_MS,
      },
      {
        aksi        : ACTUATOR_ACTIONS.CLOSE_DRAIN_VALVE,
        detail      : `${triggerDetail} | Langkah 3: Tutup katup kuras (level turun ~10 cm)`,
        delayAfterMs: 5000,
      },
      {
        aksi        : ACTUATOR_ACTIONS.OPEN_FILL_VALVE,
        detail      : `${triggerDetail} | Langkah 4: Buka katup pengisian air bersih`,
        delayAfterMs: SEQUENCE_STEP_DELAY_MS,
      },
      {
        aksi        : ACTUATOR_ACTIONS.CLOSE_FILL_VALVE,
        detail      : `${triggerDetail} | Langkah 5: Tutup katup pengisian (level naik ~3 cm)`,
        delayAfterMs: 0,
      },
    ];

    abortSequence(deviceId);
    const abortCtrl = new AbortController();
    activeAbortControllers.set(deviceId, abortCtrl);

    executeSequence(sequence, {
      mqttClient,
      deviceId,
      nodeId,
      triggerSource    : 'auto_dss',
      signal           : abortCtrl.signal,
      onStepDispatched : (aksi, commandId) => {
        if (aksi === ACTUATOR_ACTIONS.PUMP_ENGINE_STOP) {
          markEngineStopSent(deviceId, commandId);
        }
      },
    }).finally(() => {
      activeAbortControllers.delete(deviceId);
    }).catch(err => {
      console.error(`[AutoActuator] Sequence execution error:`, err.message);
    });

    tq.sendDssAlert({
      deviceId,
      nodeId,
      dssScore      : score,
      recommendation,
      readings,
      level         : 'bahaya',
    });
  }
}

module.exports = {
  evaluateAndActuate,
  dispatchActuatorCommand,
  abortSequence,
  ACTUATOR_ACTIONS,
  ACTION_CMD,
  DSS_THRESHOLD_WASPADA,
  DSS_THRESHOLD_BAHAYA,
};

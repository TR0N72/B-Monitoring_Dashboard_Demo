'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import { useSocket } from '@/hooks/useSocket';
import Sidebar from '@/components/Sidebar';
import TopAppBar from '@/components/TopAppBar';
import Toast from '@/components/Toast';

const ACTUATOR_GROUPS = [
  {
    groupKey: 'drain',
    groupLabel: 'Drain Valve',
    description: 'Katup kuras tambak — buka untuk membuang air, tutup setelah selesai.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22V12M12 12L8 16M12 12L16 16"/>
        <path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/>
      </svg>
    ),
    colorVar: '--progress-fill-blue',
    onAction: 'OPEN_DRAIN_VALVE',
    offAction: 'CLOSE_DRAIN_VALVE',
    onLabel: 'Open',
    offLabel: 'Close',
    dangerous: false,
  },
  {
    groupKey: 'fill',
    groupLabel: 'Fill Valve',
    description: 'Katup pengisian air bersih — buka untuk mengisi, tutup setelah target volume tercapai.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v10M12 12l-4-4M12 12l4-4"/>
        <path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/>
      </svg>
    ),
    colorVar: '--progress-fill-green',
    onAction: 'OPEN_FILL_VALVE',
    offAction: 'CLOSE_FILL_VALVE',
    onLabel: 'Open',
    offLabel: 'Close',
    dangerous: false,
  },
  {
    groupKey: 'pump',
    groupLabel: 'Circulation Pump',
    description: 'Pompa sirkulasi air — starter untuk aerasi aktif, stop untuk mematikan mesin.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
      </svg>
    ),
    colorVar: '--dss-waspada',
    onAction: 'PUMP_ENGINE_START',
    offAction: 'PUMP_ENGINE_STOP',
    onLabel: 'Start',
    offLabel: 'Stop',
    dangerous: false,
  },
];

function EmergencyConfirmModal({ onConfirm, onCancel }) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="emg-modal-title">
      <div className="modal-box modal-box--danger">
        <div className="modal-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </div>
        <h2 id="emg-modal-title">Konfirmasi Emergency Stop</h2>
        <p>
          Perintah ini akan <strong>menghentikan semua sistem secara paksa</strong> dan mengaktifkan
          emergency state. Seluruh perintah otomatis akan diblokir hingga admin me-reset state.
        </p>
        <p className="modal-warning-note">Lanjutkan hanya jika kondisi benar-benar darurat.</p>
        <div className="modal-actions">
          <button className="modal-btn modal-btn--cancel" onClick={onCancel}>
            Batal
          </button>
          <button className="modal-btn modal-btn--confirm-danger" onClick={onConfirm}>
            Ya, Jalankan Emergency Stop
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ActuatorPage() {
  const { isAuthenticated, loading: authLoading, user } = useAuth();
  const { apiFetch } = useApi();
  const { subscribe, connected } = useSocket();
  const router = useRouter();

  const [logs, setLogs] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loadingData, setLoadingData] = useState(true);
  const [pendingCommands, setPendingCommands] = useState({});
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState('success');
  const [selectedDevice, setSelectedDevice] = useState('');
  const [showEmergencyModal, setShowEmergencyModal] = useState(false);
  const pendingEmergencyRef = useRef(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let ignore = false;
    async function loadDevices() {
      try {
        const res = await apiFetch('/api/devices');
        if (res.ok && !ignore) {
          const json = await res.json();
          const list = json.devices || json.data || json || [];
          setDevices(list);
          if (list.length > 0) {
            setSelectedDevice((prev) => prev || list[0].node_id || list[0].name || 'ESP32-NODE-01');
          }
        }
      } catch (err) {
        console.error('[Actuator] Failed to fetch devices:', err);
      }
    }
    loadDevices();
    return () => { ignore = true; };
  }, [isAuthenticated, apiFetch]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let ignore = false;
    async function load() {
      try {
        const res = await apiFetch('/api/actuator/logs');
        if (res.ok && !ignore) {
          const json = await res.json();
          setLogs(json.data || []);
        }
      } catch (err) {
        console.error('[Actuator] Failed to fetch logs:', err);
      } finally {
        if (!ignore) setLoadingData(false);
      }
    }
    load();
    return () => { ignore = true; };
  }, [isAuthenticated, apiFetch]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const unsub = subscribe('actuator:status', (data) => {
      setLogs((prev) => [{
        ...data,
        executed_at: data.executed_at || new Date().toISOString(),
      }, ...prev].slice(0, 100));

      if (data.aksi) {
        setPendingCommands((prev) => {
          const next = { ...prev };
          delete next[data.aksi];
          return next;
        });
      }
    });
    const unsubConfirmed = subscribe('actuator:confirmed', (data) => {
      setLogs((prev) => [{
        ...data,
        trigger_source: 'failsafe',
        executed_at: data.timestamp || new Date().toISOString(),
      }, ...prev].slice(0, 100));
      if (data.aksi) {
        setPendingCommands((prev) => {
          const next = { ...prev };
          delete next[data.aksi];
          return next;
        });
      }
    });
    return () => { unsub(); unsubConfirmed(); };
  }, [isAuthenticated, subscribe]);

  const sendCommand = useCallback(async (aksi) => {
    setPendingCommands((prev) => ({ ...prev, [aksi]: true }));
    try {
      const res = await apiFetch('/api/actuator/command', {
        method: 'POST',
        body: JSON.stringify({ device_id: selectedDevice, aksi }),
      });

      if (res.ok) {
        const json = await res.json();
        setToastType('success');
        setToastMessage(`✓ "${aksi}" dikirim (ID: ${json.command_id})`);
        // Optimistic entry while waiting for WebSocket ACK.
        setLogs((prev) => [{
          id: json.command_id,
          node_id: selectedDevice,
          aksi,
          trigger_source: 'manual',
          status: 'pending',
          executed_at: new Date().toISOString(),
        }, ...prev].slice(0, 100));

        // Fallback timeout in case WebSocket ACK never arrives.
        setTimeout(() => {
          setPendingCommands((prev) => {
            if (prev[aksi]) {
              const next = { ...prev };
              delete next[aksi];
              return next;
            }
            return prev;
          });
        }, 10000);
      } else {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
    } catch (err) {
      setToastType('error');
      setToastMessage(`✕ Gagal: ${err.message}`);
      setPendingCommands((prev) => {
        const next = { ...prev };
        delete next[aksi];
        return next;
      });
    } finally {
      setShowToast(true);
    }
  }, [apiFetch, selectedDevice]);

  const handleEmergencyClick = useCallback(() => {
    pendingEmergencyRef.current = 'EMERGENCY_STOP';
    setShowEmergencyModal(true);
  }, []);

  const confirmEmergency = useCallback(async () => {
    setShowEmergencyModal(false);
    const aksi = pendingEmergencyRef.current;
    if (aksi) await sendCommand(aksi);
    pendingEmergencyRef.current = null;
  }, [sendCommand]);

  const cancelEmergency = useCallback(() => {
    setShowEmergencyModal(false);
    pendingEmergencyRef.current = null;
  }, []);

  const hideToast = useCallback(() => setShowToast(false), []);

  if (authLoading || !isAuthenticated) return null;

  const isAdmin = user?.role === 'admin';

  const displayLogs = logs;

  const getStatusIcon = (status) => {
    switch (status) {
      case 'executed': return '✓';
      case 'pending':  return '⏳';
      case 'failed':   return '✕';
      default: return '—';
    }
  };

  return (
    <div className="main-dashboard">
      <Sidebar />
      <main className="main-content">
        <div className="main-canvas">
          <TopAppBar />
          <div className="scrollable-content">

            <div className="page-header-controls">
              <div className="page-title-section">
                <div className="heading-1"><h1>Actuator Control</h1></div>
                <div className="status-indicator">
                  <div className={`status-dot ${connected ? 'active' : 'offline'}`} />
                  <p>{connected ? 'MQTT Bridge Active' : 'Connecting…'}</p>
                </div>
              </div>
              <div className="page-controls">
                <div className="device-selector">
                  <label>Target Node:</label>
                  <select
                    value={selectedDevice}
                    onChange={(e) => setSelectedDevice(e.target.value)}
                    className="device-select"
                  >
                    {devices.length > 0 ? (
                      devices.map((d) => (
                        <option key={d.id || d.node_id} value={d.node_id || d.name}>
                          {d.name ? `${d.name} (${d.node_id})` : d.node_id}
                        </option>
                      ))
                    ) : (
                      <option value="ESP32-NODE-01">ESP32-NODE-01</option>
                    )}
                  </select>
                </div>
              </div>
            </div>

            {!isAdmin && (
              <div className="actuator-notice">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <span>Perintah aktuator hanya dapat dijalankan oleh Admin. Hubungi administrator.</span>
              </div>
            )}

            <div className="actuator-grid">
              {ACTUATOR_GROUPS.map((cmd) => (
                <div key={cmd.groupKey} className="actuator-card">
                  <div className="actuator-card-icon" style={{ color: `var(${cmd.colorVar})` }}>
                    {cmd.icon}
                  </div>
                  <div className="actuator-card-info">
                    <h3>{cmd.groupLabel}</h3>
                    <p>{cmd.description}</p>
                  </div>
                  <div className="actuator-card-actions">
                    <button
                      className="actuator-btn actuator-btn-on"
                      disabled={!isAdmin || !!pendingCommands[cmd.onAction]}
                      onClick={() => sendCommand(cmd.onAction)}
                      aria-label={`${cmd.onLabel} ${cmd.groupLabel}`}
                    >
                      {pendingCommands[cmd.onAction] ? (
                        <span className="actuator-btn-spinner" />
                      ) : (
                        <>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polygon points="5 3 19 12 5 21 5 3"/>
                          </svg>
                          <span>{cmd.onLabel}</span>
                        </>
                      )}
                    </button>
                    <button
                      className="actuator-btn actuator-btn-off"
                      disabled={!isAdmin || !!pendingCommands[cmd.offAction]}
                      onClick={() => sendCommand(cmd.offAction)}
                      aria-label={`${cmd.offLabel} ${cmd.groupLabel}`}
                    >
                      {pendingCommands[cmd.offAction] ? (
                        <span className="actuator-btn-spinner" />
                      ) : (
                        <>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
                          </svg>
                          <span>{cmd.offLabel}</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="emergency-section">
              <div className="emergency-card">
                <div className="emergency-card-icon">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/>
                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                </div>
                <div className="emergency-card-info">
                  <h3>Emergency Stop</h3>
                  <p>
                    Hentikan semua sistem secara paksa. Mengaktifkan emergency state —
                    perintah otomatis diblokir hingga admin me-reset.
                  </p>
                </div>
                <div className="emergency-card-action">
                  <button
                    className="actuator-btn actuator-btn-emergency"
                    disabled={!isAdmin || !!pendingCommands['EMERGENCY_STOP']}
                    onClick={handleEmergencyClick}
                    aria-label="Emergency Stop"
                  >
                    {pendingCommands['EMERGENCY_STOP'] ? (
                      <span className="actuator-btn-spinner" />
                    ) : (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <rect x="3" y="3" width="18" height="18" rx="2"/>
                        </svg>
                        <span>EMERGENCY STOP</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div className="data-table-container">
              <div className="table-header-section">
                <h2>Command Activity Log</h2>
                <div className="table-info">
                  <p>{displayLogs.length} entries</p>
                </div>
              </div>
              <div className="table-wrapper">
                {displayLogs.length === 0 ? (
                  <div style={{ padding: '3rem 1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    <p style={{ margin: 0 }}>No actuator command executions recorded yet.</p>
                  </div>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>TIMESTAMP</th>
                        <th>NODE</th>
                        <th>ACTION</th>
                        <th>SOURCE</th>
                        <th>STATUS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayLogs.map((log, i) => (
                        <tr key={log.id || i}>
                          <td>{new Date(log.executed_at).toLocaleString()}</td>
                          <td className="fw-500">{log.node_id || `Device-${log.device_id}`}</td>
                          <td><span className="mono-text">{log.aksi}</span></td>
                          <td>
                            <span className={`source-badge source-${log.trigger_source}`}>
                              {log.trigger_source}
                            </span>
                          </td>
                          <td>
                            <span className={`status-badge status-${log.status}`}>
                              {getStatusIcon(log.status)} {log.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

          </div>

          <Toast message={toastMessage} type={toastType} show={showToast} onClose={hideToast} />
        </div>
      </main>

      {showEmergencyModal && (
        <EmergencyConfirmModal onConfirm={confirmEmergency} onCancel={cancelEmergency} />
      )}
    </div>
  );
}

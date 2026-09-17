'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import { useSocket } from '@/hooks/useSocket';
import Sidebar from '@/components/Sidebar';
import TopAppBar from '@/components/TopAppBar';
import Toast from '@/components/Toast';

const actuatorCommands = [
  {
    key: 'AERATOR_ON',
    label: 'Aerator',
    description: 'Activate water aeration system to increase dissolved oxygen.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/>
      </svg>
    ),
    onAction: 'AERATOR_ON',
    offAction: 'AERATOR_OFF',
    colorVar: '--accent-blue',
  },
  {
    key: 'PUMP_ON',
    label: 'Water Pump',
    description: 'Control water inlet/outlet pump for circulation.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>
      </svg>
    ),
    onAction: 'PUMP_ON',
    offAction: 'PUMP_OFF',
    colorVar: '--progress-fill-green',
  },
  {
    key: 'FEEDER_ON',
    label: 'Auto Feeder',
    description: 'Trigger automatic fish feeding mechanism.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>
      </svg>
    ),
    onAction: 'FEEDER_ACTIVATE',
    offAction: 'FEEDER_STOP',
    colorVar: '--dss-waspada',
  },
];

export default function ActuatorPage() {
  const { isAuthenticated, loading: authLoading, user } = useAuth();
  const { apiFetch } = useApi();
  const { subscribe, connected } = useSocket();
  const router = useRouter();
  const [logs, setLogs] = useState([]);
  const [loadingData, setLoadingData] = useState(true);
  const [pendingCommands, setPendingCommands] = useState({});
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState('success');
  const [selectedDevice, setSelectedDevice] = useState('ESP32-NODE-01');

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [authLoading, isAuthenticated, router]);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await apiFetch('/api/actuator/logs');
      if (res.ok) {
        const json = await res.json();
        setLogs(json.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch actuator logs:', err);
    } finally {
      setLoadingData(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchLogs();
  }, [isAuthenticated, fetchLogs]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const unsub = subscribe('actuator:status', (data) => {
      setLogs(prev => [{
        ...data,
        executed_at: data.executed_at || new Date().toISOString(),
      }, ...prev].slice(0, 100));

      if (data.command_id || data.aksi) {
        setPendingCommands(prev => {
          const next = { ...prev };
          delete next[data.aksi];
          return next;
        });
      }
    });
    return unsub;
  }, [isAuthenticated, subscribe]);

  const sendCommand = async (aksi) => {
    setPendingCommands(prev => ({ ...prev, [aksi]: true }));

    try {
      const res = await apiFetch('/api/actuator/command', {
        method: 'POST',
        body: JSON.stringify({ device_id: selectedDevice, aksi }),
      });

      if (res.ok) {
        const json = await res.json();
        setToastType('success');
        setToastMessage(`Command "${aksi}" sent successfully (ID: ${json.command_id})`);
        fetchLogs();
      } else {
        const errData = await res.json();
        throw new Error(errData.error || 'Command failed');
      }
    } catch (err) {
      setToastType('error');
      setToastMessage(err.message || 'Failed to send command');
      setPendingCommands(prev => {
        const next = { ...prev };
        delete next[aksi];
        return next;
      });
    } finally {
      setShowToast(true);
    }
  };

  const hideToast = useCallback(() => setShowToast(false), []);

  if (authLoading || !isAuthenticated) return null;

  const isAdmin = user?.role === 'admin';

  const displayLogs = logs.length > 0 ? logs : [
    { id: 1, node_id: 'ESP32-NODE-01', aksi: 'AERATOR_ON', trigger_source: 'manual', status: 'executed', executed_at: new Date(Date.now() - 120000).toISOString() },
    { id: 2, node_id: 'ESP32-NODE-01', aksi: 'PUMP_OFF', trigger_source: 'edge', status: 'executed', executed_at: new Date(Date.now() - 360000).toISOString() },
    { id: 3, node_id: 'ESP32-NODE-03', aksi: 'FEEDER_ACTIVATE', trigger_source: 'manual', status: 'pending', executed_at: new Date(Date.now() - 600000).toISOString() },
  ];

  const getStatusIcon = (status) => {
    switch (status) {
      case 'executed': return '✓';
      case 'pending': return '⏳';
      case 'failed': return '✕';
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
                  <div className={`status-dot ${connected ? 'active' : 'offline'}`}></div>
                  <p>{connected ? 'MQTT Bridge Active' : 'Connecting...'}</p>
                </div>
              </div>
              <div className="page-controls">
                <div className="device-selector">
                  <label>Target Node:</label>
                  <select value={selectedDevice} onChange={(e) => setSelectedDevice(e.target.value)} className="device-select">
                    <option value="ESP32-NODE-01">ESP32-NODE-01</option>
                    <option value="ESP32-NODE-02">ESP32-NODE-02</option>
                    <option value="ESP32-NODE-03">ESP32-NODE-03</option>
                  </select>
                </div>
              </div>
            </div>

            {!isAdmin && (
              <div className="actuator-notice">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                <span>Actuator commands are restricted to Admin users. Contact your administrator.</span>
              </div>
            )}

            {/* Command Cards */}
            <div className="actuator-grid">
              {actuatorCommands.map((cmd) => (
                <div key={cmd.key} className="actuator-card">
                  <div className="actuator-card-icon" style={{ color: `var(${cmd.colorVar})` }}>
                    {cmd.icon}
                  </div>
                  <div className="actuator-card-info">
                    <h3>{cmd.label}</h3>
                    <p>{cmd.description}</p>
                  </div>
                  <div className="actuator-card-actions">
                    <button
                      className="actuator-btn actuator-btn-on"
                      disabled={!isAdmin || pendingCommands[cmd.onAction]}
                      onClick={() => sendCommand(cmd.onAction)}
                    >
                      {pendingCommands[cmd.onAction] ? (
                        <span className="actuator-btn-spinner"></span>
                      ) : (
                        <>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                          <span>ON</span>
                        </>
                      )}
                    </button>
                    <button
                      className="actuator-btn actuator-btn-off"
                      disabled={!isAdmin || pendingCommands[cmd.offAction]}
                      onClick={() => sendCommand(cmd.offAction)}
                    >
                      {pendingCommands[cmd.offAction] ? (
                        <span className="actuator-btn-spinner"></span>
                      ) : (
                        <>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                          <span>OFF</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Activity Log */}
            <div className="data-table-container">
              <div className="table-header-section">
                <h2>Command Activity Log</h2>
                <div className="table-info">
                  <p>{displayLogs.length} entries</p>
                </div>
              </div>
              <div className="table-wrapper">
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
              </div>
            </div>
          </div>
          <Toast message={toastMessage} type={toastType} show={showToast} onClose={hideToast} />
        </div>
      </main>
    </div>
  );
}

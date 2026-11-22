'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import { useTheme } from '@/context/ThemeContext';
import { useSocket } from '@/context/SocketContext';
import Sidebar from '@/components/Sidebar';
import TopAppBar from '@/components/TopAppBar';
import AlertBanner from '@/components/AlertBanner';
import NodeCard from '@/components/NodeCard';

const MAX_LOG_ROWS = 50;

export default function DashboardPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { apiFetch } = useApi();
  const { isDarkMode, toggleDarkMode } = useTheme();
  const { subscribe } = useSocket();
  const router = useRouter();
  const [devices, setDevices] = useState([]);
  const [readingsMap, setReadingsMap] = useState({});
  const [logs, setLogs] = useState([]);
  const [loadingData, setLoadingData] = useState(true);
  const lastWsTimestampRef = useRef(null);
  const [viewMode, setViewMode] = useState(() => {
    try { return typeof window !== 'undefined' && localStorage.getItem('bmon_dash_view') === 'table' ? 'table' : 'cards'; } catch { return 'cards'; }
  });
  const changeView = (mode) => {
    setViewMode(mode);
    try { localStorage.setItem('bmon_dash_view', mode); } catch { /* abaikan */ }
  };

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!isAuthenticated) return;

    async function fetchData() {
      try {
        const [devicesRes, latestRes, logsRes] = await Promise.allSettled([
          apiFetch('/api/devices'),
          apiFetch('/api/sensors/latest'),
          apiFetch('/api/sensors/history?limit=50'),
        ]);

        if (devicesRes.status === 'fulfilled' && devicesRes.value.ok) {
          const data = await devicesRes.value.json();
          setDevices(data.devices || []);
        }

        if (latestRes.status === 'fulfilled' && latestRes.value.ok) {
          const data = await latestRes.value.json();
          const map = {};
          (data.readings || []).forEach((r) => {
            const key = r.node_id || r.device_id;
            if (key) map[key] = r;
          });
          setReadingsMap(map);
        }

        if (logsRes.status === 'fulfilled' && logsRes.value.ok) {
          const data = await logsRes.value.json();
          setLogs(data.data || []);
        }
      } catch (err) {
        console.error('Failed to fetch dashboard data:', err);
      } finally {
        setLoadingData(false);
      }
    }

    fetchData();
  }, [isAuthenticated, apiFetch]);

  const handleSensorUpdate = useCallback((payload) => {
    if (!payload || typeof payload !== 'object') return;

    const ts = payload.recorded_at || payload.created_at || null;
    if (ts && ts === lastWsTimestampRef.current) return;
    lastWsTimestampRef.current = ts;

    const key = payload.node_id || payload.device_id;
    if (key) {
      setReadingsMap((prev) => ({ ...prev, [key]: payload }));
    }

    setLogs((prev) => [payload, ...prev].slice(0, MAX_LOG_ROWS));
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    const unsubscribe = subscribe('sensor_update', handleSensorUpdate);
    return unsubscribe;
  }, [isAuthenticated, subscribe, handleSensorUpdate]);

  if (authLoading) return null;
  if (!isAuthenticated) return null;

  const sensorNodes = devices.filter((d) => d.type === 'sensor_node');

  return (
    <div className="main-dashboard">
      <Sidebar />
      <main className="main-content">
        <div className="main-canvas">
          <AlertBanner />
          <TopAppBar />
          <div className="scrollable-content">
            <div className="page-header-controls">
              <div className="page-title-section">
                <div className="heading-1">
                  <h1>Tambak Bandeng</h1>
                </div>
                <div className="status-indicator">
                  <div className="status-dot"></div>
                  <p>Live Monitoring Active</p>
                </div>
              </div>
              <div className="page-controls">
                <div role="group" aria-label="Node view" className="view-toggle">
                  <button className={`control-btn ${viewMode === 'cards' ? 'solid' : 'outline'}`} aria-pressed={viewMode === 'cards'} onClick={() => changeView('cards')}>Cards</button>
                  <button className={`control-btn ${viewMode === 'table' ? 'solid' : 'outline'}`} aria-pressed={viewMode === 'table'} onClick={() => changeView('table')}>Table</button>
                </div>
                <button className="control-btn outline" onClick={toggleDarkMode}>
                  <div className="btn-icon">
                    <img src="/assets/78ae8b57bff3076f255b8b5e1fec2ccd53b32508.svg" alt="Color Mode" />
                  </div>
                  <span>{isDarkMode ? 'Light Mode' : 'Dark Mode'}</span>
                </button>
              </div>
            </div>

            {viewMode === 'table' && sensorNodes.length > 0 ? (
              <div className="data-table-container">
                <div className="table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Node</th><th>Status</th><th>Temp (°C)</th><th>Jarak (cm)</th>
                        <th>Salinity (ppt)</th><th>Turbidity (NTU)</th><th>Cycle</th><th>Last update</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sensorNodes.map((device) => {
                        const r = readingsMap[device.node_id || device.id] || {};
                        const ts = r.recorded_at || r.created_at;
                        return (
                          <tr key={device.node_id || device.id} className="clickable-row" onClick={() => router.push(`/sensors/${device.id}`)}>
                            <td className="fw-500">{device.name || device.node_id}</td>
                            <td>
                              <div className="status-indicator">
                                <div className={`status-dot ${device.status === 'online' ? 'active' : 'offline'}`}></div>
                                <span>{{ online: 'Online', maintenance: 'Maintenance' }[device.status] || 'Offline'}</span>
                              </div>
                            </td>
                            <td>{r.suhu ?? '—'}</td>
                            <td>{r.jarak_cm ?? '—'}</td>
                            <td>{r.salinitas ?? '—'}</td>
                            <td>{r.turbidity ?? '—'}</td>
                            <td>{r.siklus_status ?? '—'}</td>
                            <td>{ts ? new Date(ts).toLocaleString() : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
            <div className="node-cards-grid">
              {sensorNodes.length === 0 ? (
                <div className="no-nodes">Belum ada node sensor terdaftar.</div>
              ) : (
                sensorNodes.map((device) => {
                  const key = device.node_id || device.id;
                  return (
                    <NodeCard
                      key={key}
                      device={device}
                      initialReading={readingsMap[key] || null}
                    />
                  );
                })
              )}
            </div>
            )}

            <div className="chart-container">
              <div className="chart-header">
                <h2>Live Telemetry (Last 24h)</h2>
              </div>
              <div className="chart-area">
                <iframe
                  src={`${(typeof window !== 'undefined' && window.location.protocol === 'https:' && process.env.NEXT_PUBLIC_GRAFANA_URL?.startsWith('http:')) ? process.env.NEXT_PUBLIC_GRAFANA_URL.replace('http:', 'https:') : (process.env.NEXT_PUBLIC_GRAFANA_URL || 'http://localhost:3000')}/d-solo/bmonitor-telemetry?orgId=1&panelId=1&theme=light&kiosk=tv`}
                  width="100%"
                  height="100%"
                  frameBorder="0"
                  style={{ border: 'none', borderRadius: '2px', position: 'relative', zIndex: 1 }}
                  title="Grafana Telemetry Chart"
                ></iframe>
              </div>
            </div>

            <div className="data-table-container">
              <div className="table-header-section">
                <h2>Historical Logs</h2>
                <div className="table-info">
                  <p>{loadingData ? 'Loading…' : logs.length > 0 ? `Showing last ${logs.length} entries` : 'No data yet'}</p>
                </div>
              </div>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Node</th>
                      <th>Temp (°C)</th>
                      <th>Jarak (cm)</th>
                      <th>Salinity (ppt)</th>
                      <th>Turbidity (NTU)</th>
                      <th>Cycle</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingData ? (
                      [1, 2, 3].map((n) => (
                        <tr key={`skel-${n}`} className="skeleton-row">
                          <td><span className="skeleton-cell" /></td>
                          <td><span className="skeleton-cell skeleton-cell--sm" /></td>
                          <td><span className="skeleton-cell skeleton-cell--sm" /></td>
                          <td><span className="skeleton-cell skeleton-cell--sm" /></td>
                          <td><span className="skeleton-cell skeleton-cell--sm" /></td>
                          <td><span className="skeleton-cell skeleton-cell--sm" /></td>
                          <td><span className="skeleton-cell skeleton-cell--sm" /></td>
                          <td><span className="skeleton-cell skeleton-cell--sm" /></td>
                        </tr>
                      ))
                    ) : logs.length > 0 ? (
                      logs.map((log, i) => {
                        const turbVal = log.turbidity ?? null;
                        const isDanger = turbVal !== null && turbVal > 15;
                        return (
                          <tr key={log.id || i}>
                            <td>{new Date(log.recorded_at || log.created_at).toLocaleString()}</td>
                            <td>{log.node_id || '—'}</td>
                            <td>{log.suhu ?? '—'}</td>
                            <td>{log.jarak_cm ?? '—'}</td>
                            <td>{log.salinitas ?? '—'}</td>
                            <td className={isDanger ? 'warning-text' : ''}>{turbVal ?? '—'}</td>
                            <td>{log.siklus_status ?? '—'}</td>
                            <td>
                              <span className={`status-badge ${isDanger ? 'warning' : 'normal'}`}>
                                {isDanger ? 'Warning' : 'Normal'}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px 0', fontStyle: 'italic' }}>
                          No sensor readings recorded yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
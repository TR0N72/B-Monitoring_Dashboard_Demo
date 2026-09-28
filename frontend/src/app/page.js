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
import MetricCard from '@/components/MetricCard';

/** Maximum number of log rows kept in memory to avoid unbounded growth. */
const MAX_LOG_ROWS = 50;

export default function DashboardPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { apiFetch } = useApi();
  const { isDarkMode, toggleDarkMode } = useTheme();
  const { subscribe } = useSocket();
  const router = useRouter();
  const [sensorData, setSensorData] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loadingData, setLoadingData] = useState(true);
  // Track the last WebSocket event timestamp to deduplicate rapid bursts
  const lastWsTimestampRef = useRef(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!isAuthenticated) return;

    async function fetchData() {
      try {
        const [sensorRes, logsRes] = await Promise.allSettled([
          apiFetch('/api/sensors/latest'),
          apiFetch('/api/sensors/history?limit=5'),
        ]);

        if (sensorRes.status === 'fulfilled' && sensorRes.value.ok) {
          const data = await sensorRes.value.json();
          // API returns { readings: [...] } — take the first (most recent) entry
          setSensorData(data.readings?.[0] ?? null);
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

  /**
   * WebSocket subscription — updates metric cards and prepends the new reading
   * to the historical log table without triggering a full refetch.
   *
   * Wrapped in useCallback so the reference is stable across renders, which
   * prevents the subscribe/unsubscribe cycle from firing on every render.
   */
  const handleSensorUpdate = useCallback((payload) => {
    // Payload shape: { suhu, ph_level, salinitas, turbidity, recorded_at, node_id, ... }
    if (!payload || typeof payload !== 'object') return;

    // Deduplicate: ignore if this exact timestamp was already processed
    const ts = payload.recorded_at || payload.created_at || null;
    if (ts && ts === lastWsTimestampRef.current) return;
    lastWsTimestampRef.current = ts;

    // Update the live metric cards
    setSensorData((prev) => ({ ...(prev ?? {}), ...payload }));

    // Prepend to historical log, capped at MAX_LOG_ROWS
    setLogs((prev) => [payload, ...prev].slice(0, MAX_LOG_ROWS));
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;

    // Subscribe returns an unsubscribe function — call it on cleanup
    const unsubscribe = subscribe('sensor_update', handleSensorUpdate);
    return unsubscribe;
  }, [isAuthenticated, subscribe, handleSensorUpdate]);

  if (authLoading) return null;
  if (!isAuthenticated) return null;

  // Use null when no real data is available — avoids phantom alarm states
  const temp     = sensorData?.suhu     ?? null;
  const ph       = sensorData?.ph_level ?? null;
  const salinity = sensorData?.salinitas ?? null;
  const turbidity = sensorData?.turbidity ?? null;

  // Danger flag only when we have real data exceeding threshold
  const isTurbidityDanger = turbidity !== null && turbidity > 15;

  // Progress bar widths derived from sensor ranges (show 0% when no data)
  const tempFill     = temp     !== null ? `${Math.min(100, Math.max(0, ((temp - 20) / 20) * 100)).toFixed(0)}%` : '0%';
  const phFill       = ph       !== null ? `${Math.min(100, Math.max(0, (ph / 14) * 100)).toFixed(0)}%`           : '0%';
  const salinityFill = salinity  !== null ? `${Math.min(100, Math.max(0, (salinity / 50) * 100)).toFixed(0)}%`    : '0%';
  const turbidityFill = turbidity !== null ? `${Math.min(100, Math.max(0, (turbidity / 30) * 100)).toFixed(0)}%`  : '0%';

  // Display values — show '—' when data is unavailable (never show phantom numbers)
  const displayTemp     = temp     !== null ? temp     : '—';
  const displayPh       = ph       !== null ? ph       : '—';
  const displaySalinity = salinity  !== null ? salinity  : '—';
  const displayTurbidity = turbidity !== null ? turbidity : '—';

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
                  <h1>Unit 04 Overview</h1>
                </div>
                <div className="status-indicator">
                  <div className="status-dot"></div>
                  <p>Live Monitoring Active</p>
                </div>
              </div>
              <div className="page-controls">
                <button className="control-btn outline" onClick={toggleDarkMode}>
                  <div className="btn-icon">
                    <img src="/assets/78ae8b57bff3076f255b8b5e1fec2ccd53b32508.svg" alt="Color Mode" />
                  </div>
                  <span>{isDarkMode ? 'Light Mode' : 'Dark Mode'}</span>
                </button>
                {/* Table Mode - Future Development
                <button className="control-btn solid">
                  <div className="btn-icon">
                    <img src="/assets/8b9e5a6b17142aaccf9de7da53652d2c80a0ae45.svg" alt="Table Mode" />
                  </div>
                  <span>Table Mode</span>
                </button>
                */}
              </div>
            </div>

            <div className="metric-cards-grid">
              <MetricCard label="TEMPERATURE" value={displayTemp} unit={temp !== null ? '°C' : ''} icon="/assets/aa1f13350a63705391a2fd719fbfea1ec8a0d775.svg" fillWidth={tempFill} fillColor="var(--progress-fill-blue)" />
              <MetricCard label="PH LEVEL" value={displayPh} unit="" icon="/assets/175d2836fad0f392a3e0301c7f021e3b9233f740.svg" fillWidth={phFill} fillColor="var(--progress-fill-green)" />
              <MetricCard label="SALINITY" value={displaySalinity} unit={salinity !== null ? 'ppt' : ''} icon="/assets/aa1f13350a63705391a2fd719fbfea1ec8a0d775.svg" fillWidth={salinityFill} fillColor="var(--progress-fill-blue)" />
              <MetricCard label="TURBIDITY" value={displayTurbidity} unit={turbidity !== null ? 'NTU' : ''} isDanger={isTurbidityDanger} fillWidth={turbidityFill} />
            </div>

            <div className="chart-container">
              <div className="chart-header">
                <h2>Live Telemetry (Last 24h)</h2>
              </div>
              <div className="chart-area">
                <iframe
                  src={`${process.env.NEXT_PUBLIC_GRAFANA_URL || 'http://localhost:3000'}/d-solo/bmonitor-telemetry?orgId=1&panelId=1&theme=light&kiosk=tv`}
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
                      <th>Temp (°C)</th>
                      <th>pH</th>
                      <th>Salinity (ppt)</th>
                      <th>Turbidity (NTU)</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingData ? (
                      // Skeleton rows while fetching — no false data
                      [1, 2, 3].map((n) => (
                        <tr key={`skel-${n}`} className="skeleton-row">
                          <td><span className="skeleton-cell" /></td>
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
                            <td>{log.suhu ?? '—'}</td>
                            <td>{log.ph_level ?? '—'}</td>
                            <td>{log.salinitas ?? '—'}</td>
                            <td className={isDanger ? 'warning-text' : ''}>{turbVal ?? '—'}</td>
                            <td>
                              <span className={`status-badge ${isDanger ? 'warning' : 'normal'}`}>
                                {isDanger ? 'Warning' : 'Normal'}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      // True empty state — no phantom rows
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px 0', fontStyle: 'italic' }}>
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
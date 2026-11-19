'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useSocket } from '@/context/SocketContext';
import { useApi } from '@/hooks/useApi';
import Sidebar from '@/components/Sidebar';
import TopAppBar from '@/components/TopAppBar';

function formatRelative(timeIso) {
  if (!timeIso) return '—';
  const diff = (Date.now() - new Date(timeIso).getTime()) / 1000;
  if (diff < 0) return '—';
  if (diff < 60) return `${Math.floor(diff)} dtk lalu`;
  if (diff < 3600) return `${Math.floor(diff / 60)} mnt lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  return new Date(timeIso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function dssClass(rec) {
  if (!rec) return '';
  const r = String(rec).toLowerCase();
  if (r === 'aman') return 'status-aman';
  if (r === 'waspada') return 'status-waspada';
  if (r === 'bahaya') return 'status-bahaya';
  return '';
}

function cycleBadgeClass(status) {
  if (!status) return '';
  const s = String(status).toUpperCase();
  if (s === 'FILL') return 'cycle-fill';
  if (s === 'SETTLE') return 'cycle-settle';
  if (s === 'MEASURE') return 'cycle-measure';
  if (s === 'DRAIN') return 'cycle-drain';
  if (s === 'IDLE') return 'cycle-idle';
  return '';
}

function metricBox(label, value, unit = '', className = '') {
  if (value === null || value === undefined) return null;
  const display = typeof value === 'number' ? value.toFixed(value % 1 === 0 ? 0 : 1) : value;
  return (
    <div className={`metric-box ${className}`}>
      <span className="metric-label">{label}</span>
      <span className="metric-value">
        {display}
        {unit && <span className="metric-unit">{unit}</span>}
      </span>
    </div>
  );
}

export default function NodeDetailsPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { apiFetch } = useApi();
  const { subscribe } = useSocket();
  const router = useRouter();
  const params = useParams();
  const [device, setDevice] = useState(null);
  const [readings, setReadings] = useState([]);
  const [latestFuzzy, setLatestFuzzy] = useState(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!isAuthenticated || !params.id) return;
    async function fetchDevice() {
      try {
        const res = await apiFetch(`/api/devices/${params.id}`);
        if (res.ok) {
          const data = await res.json();
          const dev = data.device || data;
          setDevice(dev);

          const hr = await apiFetch(`/api/sensors/history?device_id=${encodeURIComponent(dev.node_id || params.id)}&limit=200`);
          if (hr.ok) {
            const hj = await hr.json();
            setReadings(hj.data || hj.readings || []);
          }

          const fr = await apiFetch(`/api/dss?device_id=${encodeURIComponent(dev.node_id || params.id)}&limit=1`);
          if (fr.ok) {
            const fj = await fr.json();
            if (fj.data?.length) setLatestFuzzy(fj.data[0]);
          }
        }
      } catch (err) {
        console.error('Failed to fetch device:', err);
      }
    }
    fetchDevice();
  }, [isAuthenticated, params.id, apiFetch]);

  const nodeId = device?.node_id || params.id;
  useEffect(() => {
    if (!isAuthenticated || !device) return;
    return subscribe('sensor_update', (p) => {
      if (!p || (p.node_id !== nodeId && p.device_id !== device.id)) return;
      setReadings((prev) => (prev.some((r) => r.id === p.id) ? prev : [p, ...prev].slice(0, 200)));
    });
  }, [isAuthenticated, device, nodeId, subscribe]);

  useEffect(() => {
    if (!isAuthenticated || !device) return;
    return subscribe('dss:update', (p) => {
      if (!p || (p.node_id !== nodeId && p.device_id !== device.id)) return;
      setLatestFuzzy(p);
    });
  }, [isAuthenticated, device, nodeId, subscribe]);

  if (authLoading || !isAuthenticated) return null;

  if (!device) {
    return (
      <div className="main-dashboard">
        <Sidebar />
        <main className="main-content">
          <div className="main-canvas">
            <TopAppBar />
            <div className="scrollable-content" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              <p>Device not found or still loading...</p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const d = device;
  const temps = readings.filter((r) => r.suhu != null).map((r) => Number(r.suhu));
  const salts = readings.filter((r) => r.salinitas != null).map((r) => Number(r.salinitas));
  const avgTemp = temps.length ? (temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1) : '—';
  const avgSal = salts.length ? (salts.reduce((a, b) => a + b, 0) / salts.length).toFixed(1) : '—';
  const last = readings[0];
  const lastRssi = last?.rssi != null ? last.rssi : '—';
  const lastSeen = last ? formatRelative(last.recorded_at) : (d.last_seen ? formatRelative(d.last_seen) : '—');

  return (
    <div className="main-dashboard">
      <Sidebar />
      <main className="main-content">
        <div className="main-canvas">
          <TopAppBar />
          <div className="scrollable-content">
            <div className="page-header-controls">
              <div className="page-title-section">
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <div className="heading-1"><h1>{d.name || d.node_id || 'Node Details'}</h1></div>
                  <div className={`status-indicator-pill ${cycleBadgeClass(last?.siklus_status || d.status)}`}>
                    <div className="status-dot"></div>
                    <span>{last?.siklus_status || (d.status === 'offline' ? 'Offline' : 'Online')}</span>
                  </div>
                </div>
                <div className="status-indicator" style={{ marginTop: '4px' }}>
                  {d.node_id} • {d.location || d.lokasi || 'B-Monitor Node'}
                </div>
              </div>
            </div>

            <div className="dashboard-grid-12">
              <div className="col-span-4">
                <div className="info-card">
                  <div className="info-card-header"><h2>Current Readings</h2></div>
                  <div className="info-list">
                    {metricBox('Suhu', last?.suhu, '°C')}
                    {metricBox('Salinitas', last?.salinitas, 'ppt')}
                    {last?.ph_level !== null && last?.ph_level !== undefined && metricBox('pH', last.ph_level, '')}
                    {last?.turbidity !== null && last?.turbidity !== undefined && metricBox('Kekeruhan', last.turbidity, 'NTU')}
                    {metricBox('Baterai', last?.baterai, '%')}
                    {metricBox('RSSI', last?.rssi, 'dBm')}
                    {metricBox('Jarak Air', last?.jarak_cm, 'cm')}
                    {metricBox('Seq', last?.seq, '')}
                    {metricBox('ADC', last?.adc, '')}
                  </div>
                </div>

                <div className="info-card">
                  <div className="info-card-header"><h2>Device Info</h2></div>
                  <div className="info-list">
                    <div className="info-item"><span className="info-label">Node ID</span><span className="info-value mono">{d.node_id || '—'}</span></div>
                    <div className="info-item"><span className="info-label">MAC</span><span className="info-value mono">{d.mac_address || '—'}</span></div>
                    <div className="info-item"><span className="info-label">Lokasi</span><span className="info-value">{d.location || d.lokasi || '—'}</span></div>
                    <div className="info-item"><span className="info-label">Tipe</span><span className="info-value">{d.type || 'sensor_node'}</span></div>
                    <div className="info-item"><span className="info-label">Status</span><span className="info-value">{d.status || 'Active'}</span></div>
                    <div className="info-item"><span className="info-label">Terakhir Lihat</span><span className="info-value">{lastSeen}</span></div>
                    <div className="info-item"><span className="info-label">Rata-rata Suhu</span><span className="info-value">{avgTemp} °C</span></div>
                    <div className="info-item"><span className="info-label">Rata-rata Salinitas</span><span className="info-value">{avgSal} ppt</span></div>
                    <div className="info-item"><span className="info-label">Total Pembacaan</span><span className="info-value">{readings.length}</span></div>
                  </div>
                </div>

                {latestFuzzy && (
                  <div className="info-card">
                    <div className="info-card-header"><h2>DSS Terbaru</h2></div>
                    <div className="info-list">
                      <div className="info-item"><span className="info-label">Skor</span><span className="info-value">{Number(latestFuzzy.dss_score).toFixed(1)}</span></div>
                      <div className="info-item"><span className="info-label">Rekomendasi</span><span className={`info-value dss-badge ${dssClass(latestFuzzy.dss_recommendation)}`}>{(latestFuzzy.dss_recommendation || '—').toUpperCase()}</span></div>
                      <div className="info-item"><span className="info-label">Visual Label</span><span className="info-value">{latestFuzzy.visual_label || 'Normal'}</span></div>
                      <div className="info-item"><span className="info-label">Suhu Membership</span><span className="info-value">{latestFuzzy.suhu_membership || '—'}</span></div>
                      <div className="info-item"><span className="info-label">Salinitas Membership</span><span className="info-value">{latestFuzzy.salinitas_membership || '—'}</span></div>
                      {latestFuzzy.fired_rules && (
                        <div className="info-item">
                          <span className="info-label">Aturan Aktif</span>
                          <span className="info-value" style={{ maxWidth: '100%', wordBreak: 'break-word' }}>
                            {(typeof latestFuzzy.fired_rules === 'string' ? JSON.parse(latestFuzzy.fired_rules) : latestFuzzy.fired_rules).map((r) => r.description || r.rule_id).join('; ') || '—'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="col-span-8">
                <div className="chart-container" style={{ height: '400px', padding: '25px' }}>
                  <div className="chart-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: 'none', paddingBottom: '16px' }}>
                    <h2 style={{ fontFamily: "'Manrope', sans-serif", fontSize: '20px' }}>Real-time Telemetry</h2>
                  </div>
                  <div className="chart-area" >
                    {temps.length > 1 ? (() => {
                      const pts = readings.filter((r) => r.suhu != null).slice(0, 60).reverse();
                      const sal = pts.filter((r) => r.salinitas != null);
                      const line = (arr, key) => {
                        const v = arr.map((r) => Number(r[key]));
                        const lo = Math.min(...v), span = Math.max(...v) - lo || 1;
                        return v.map((x, i) => `${(i / (v.length - 1)) * 400},${55 - ((x - lo) / span) * 50}`).join(' ');
                      };
                      const tLo = Math.min(...pts.map((r) => Number(r.suhu))), tHi = Math.max(...pts.map((r) => Number(r.suhu)));
                      return (
                        <div className="chart-plot">
                        <div className="chart-legend">
                          <span><i style={{ background: '#3b82f6' }} />Suhu {tLo.toFixed(1)}–{tHi.toFixed(1)} °C</span>
                          {sal.length > 1 && <span><i style={{ background: '#22c55e' }} />Salinitas (ppt)</span>}
                        </div>
                        <svg viewBox="0 0 400 60" width="100%" height="100%" preserveAspectRatio="none" role="img" aria-label={`Suhu ${tLo.toFixed(1)} sampai ${tHi.toFixed(1)} °C, ${sal.length} titik salinitas`}>
                          <polyline points={line(pts, 'suhu')} fill="none" stroke="#3b82f6" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                          {sal.length > 1 && <polyline points={line(sal, 'salinitas')} fill="none" stroke="#22c55e" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeDasharray="4,3" />}
                        </svg>
                        </div>
                      );
                    })() : <span className="chart-placeholder">Belum cukup data telemetry.</span>}
                  </div>
                </div>

                <div className="recent-logs-card">
                  <div className="recent-logs-header">
                    <h2>Recent Logs</h2>
                  </div>
                  <div className="recent-logs-table-container" style={{ overflowX: 'auto' }}>
                    <table className="recent-logs-table">
                      <thead>
                        <tr>
                          <th style={{ width: '180px' }}>TIMESTAMP</th>
                          <th style={{ width: '80px' }}>CYCLE</th>
                          <th style={{ width: '90px' }}>TEMP</th>
                          <th style={{ width: '90px' }}>SALINITY</th>
                          <th style={{ width: '70px' }}>RSSI</th>
                          <th style={{ width: '70px' }}>BATT</th>
                          <th>SEQ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {readings.slice(0, 15).map((r) => (
                          <tr key={r.id}>
                            <td>{new Date(r.recorded_at).toLocaleString('id-ID')}</td>
                            <td><span className={`log-badge ${cycleBadgeClass(r.siklus_status)}`}>{r.siklus_status || '—'}</span></td>
                            <td>{r.suhu ?? '—'}</td>
                            <td>{r.salinitas ?? '—'}</td>
                            <td>{r.rssi ?? '—'}</td>
                            <td>{r.baterai ?? '—'}</td>
                            <td>{r.seq ?? '—'}</td>
                          </tr>
                        ))}
                        {readings.length === 0 && <tr><td colSpan={7}>No telemetry yet.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
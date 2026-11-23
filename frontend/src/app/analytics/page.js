'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import Sidebar from '@/components/Sidebar';
import TopAppBar from '@/components/TopAppBar';

const RANGE_PARAM = { '24h': '24h', '7 Days': '7d', '30 Days': '30d', 'All Time': 'all' };
const METRIC_CARDS = [
  { key: 'suhu', label: 'AVG TEMPERATURE', unit: '°C' },
  { key: 'jarak_cm', label: 'AVG WATER DISTANCE', unit: 'cm' },
  { key: 'salinitas', label: 'AVG SALINITY', unit: 'ppt' },
  { key: 'turbidity', label: 'AVG TURBIDITY', unit: 'NTU' },
];
const ARROW = { up: '▲', down: '▼', stable: '—' };
const fmt = (v) => (v == null ? '—' : Number(v).toFixed(1));

export default function AnalyticsPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { apiFetch } = useApi();
  const router = useRouter();
  const [activeFilter, setActiveFilter] = useState('24h');
  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [byNode, setByNode] = useState([]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let ignore = false;
    async function fetchStats() {
      setLoadingStats(true);
      try {
        const res = await apiFetch(`/api/sensors/stats?range=${RANGE_PARAM[activeFilter]}`);
        if (res.ok && !ignore) {
          const json = await res.json();
          setStats(json);
          setByNode(json.nodes || []);
        }
      } catch (err) {
        console.error('[Analytics] Failed to fetch stats:', err);
      } finally {
        if (!ignore) setLoadingStats(false);
      }
    }
    fetchStats();
    return () => { ignore = true; };
  }, [isAuthenticated, activeFilter, apiFetch]);

  if (authLoading || !isAuthenticated) return null;

  const filters = ['24h', '7 Days', '30 Days', 'All Time'];

  return (
    <div className="main-dashboard">
      <Sidebar />
      <main className="main-content">
        <div className="main-canvas">
          <TopAppBar />
          <div className="scrollable-content">
            <div className="page-header-controls">
              <div className="page-title-section">
                <div className="heading-1"><h1>Analytics</h1></div>
                <div className="status-indicator"><p>Aggregated water quality metrics and trend analysis.</p></div>
              </div>
              <div className="page-controls">
                <div className="button-group">
                  {filters.map((f) => (
                    <button key={f} className={`filter-btn ${activeFilter === f ? 'active' : ''}`} onClick={() => setActiveFilter(f)}>{f}</button>
                  ))}
                </div>
              </div>
            </div>

            <div className="analytics-stat-row">
              {METRIC_CARDS.map(({ key, label, unit }) => {
                const m = stats?.metrics?.[key];
                return (
                  <div className="analytics-stat-card" key={key}>
                    <div className="stat-card-label">{label}</div>
                    <div className="stat-card-value"><span className="value">{loadingStats ? '…' : fmt(m?.avg)}</span><span className="unit">{unit}</span></div>
                    <div className="stat-card-trend stable">
                      <span>{m?.count ? `${ARROW[m.trend]} ${m.change_pct != null ? `${m.change_pct > 0 ? '+' : ''}${m.change_pct}%` : ''} · min ${fmt(m.min)} · max ${fmt(m.max)} · ${m.count} samples` : 'No data in range'}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="analytics-charts-grid">
              <div className="chart-container analytics-chart-large">
                <div className="chart-header">
                  <h2>Water Quality Trends</h2>
                  <div className="chart-legend">
                    <span className="legend-item"><span className="legend-dot" style={{ backgroundColor: '#3b82f6' }}></span> Temperature</span>
                    <span className="legend-item"><span className="legend-dot" style={{ backgroundColor: '#22c55e' }}></span> Water Distance</span>
                    <span className="legend-item"><span className="legend-dot" style={{ backgroundColor: '#f59e0b' }}></span> Salinity</span>
                    <span className="legend-item"><span className="legend-dot" style={{ backgroundColor: '#ef4444' }}></span> Turbidity</span>
                  </div>
                </div>
                <div className="chart-area">
                  <iframe src={`${process.env.NEXT_PUBLIC_GRAFANA_URL ?? 'http://localhost:3000'}/d-solo/bmonitor-main/water-quality?orgId=1&panelId=1&theme=light&kiosk`} width="100%" height="100%" frameBorder="0"></iframe>
                </div>
              </div>
              <div className="chart-container analytics-chart-medium">
                <div className="chart-header"><h2>Parameter Correlation</h2></div>
                <div className="chart-area">
                  <iframe src={`${process.env.NEXT_PUBLIC_GRAFANA_URL ?? 'http://localhost:3000'}/d-solo/bmonitor-main/water-quality?orgId=1&panelId=2&theme=light&kiosk`} width="100%" height="100%" frameBorder="0"></iframe>
                </div>
              </div>
              <div className="chart-container analytics-chart-medium">
                <div className="chart-header"><h2>Alert Frequency</h2></div>
                <div className="chart-area">
                  <iframe src={`${process.env.NEXT_PUBLIC_GRAFANA_URL ?? 'http://localhost:3000'}/d-solo/bmonitor-main/water-quality?orgId=1&panelId=3&theme=light&kiosk`} width="100%" height="100%" frameBorder="0"></iframe>
                </div>
              </div>
            </div>

            <div className="data-table-container">
              <div className="table-title-bar"><h2>Data Summary — By Node</h2></div>
              <table className="data-table">
                <thead>
                  <tr><th>NODE</th><th>AVG TEMP (°C)</th><th>AVG DISTANCE (cm)</th><th>AVG SALINITY (ppt)</th><th>AVG TURBIDITY (NTU)</th><th>STATUS</th></tr>
                </thead>
                <tbody>
                  {byNode.map(n => (
                    <tr key={n.node_id}><td className="fw-500">{n.name || n.node_id}</td><td>{fmt(n.suhu)}</td><td>{fmt(n.jarak_cm)}</td><td>{fmt(n.salinitas)}</td><td>{fmt(n.turbidity)}</td><td><div className="status-indicator"><div className={`status-dot ${n.online ? 'active' : 'offline'}`}></div><span>{n.online ? 'Online' : 'Offline'}</span></div></td></tr>
                  ))}
                  {byNode.length === 0 && <tr><td colSpan={6}>No data.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
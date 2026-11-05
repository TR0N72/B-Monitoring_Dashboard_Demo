'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import Sidebar from '@/components/Sidebar';
import TopAppBar from '@/components/TopAppBar';

export default function AnalyticsPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { apiFetch } = useApi();
  const router = useRouter();
  const [activeFilter, setActiveFilter] = useState('24h');
  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let ignore = false;
    async function fetchStats() {
      setLoadingStats(true);
      try {
        const res = await apiFetch('/api/sensors/history?limit=300');
        if (res.ok && !ignore) {
          const json = await res.json();
          const list = json.data || json || [];
          
          const now = Date.now();
          const cutoff = 
            activeFilter === '24h' ? now - 24 * 3600 * 1000 :
            activeFilter === '7 Days' ? now - 7 * 86400 * 1000 :
            activeFilter === '30 Days' ? now - 30 * 86400 * 1000 : 0;

          const filtered = list.filter(item => {
            if (!cutoff) return true;
            const ts = new Date(item.recorded_at || item.created_at || item.timestamp).getTime();
            return !isNaN(ts) && ts >= cutoff;
          });

          const dataset = filtered.length > 0 ? filtered : list; // ponytail: fallback to recent batch if empty in strict window

          let sumTemp = 0, countTemp = 0;
          let sumPh = 0, countPh = 0;
          let sumSal = 0, countSal = 0;
          let sumTurb = 0, countTurb = 0;

          dataset.forEach(d => {
            if (d.suhu != null) { sumTemp += Number(d.suhu); countTemp++; }
            if (d.ph_level != null) { sumPh += Number(d.ph_level); countPh++; }
            if (d.salinitas != null) { sumSal += Number(d.salinitas); countSal++; }
            if (d.turbidity != null) { sumTurb += Number(d.turbidity); countTurb++; }
          });

          setStats({
            avgTemp: countTemp > 0 ? (sumTemp / countTemp).toFixed(1) : '—',
            avgPh: countPh > 0 ? (sumPh / countPh).toFixed(1) : '—',
            avgSal: countSal > 0 ? (sumSal / countSal).toFixed(1) : '—',
            avgTurb: countTurb > 0 ? (sumTurb / countTurb).toFixed(1) : '—',
            count: dataset.length
          });
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
              <div className="analytics-stat-card">
                <div className="stat-card-label">AVG TEMPERATURE</div>
                <div className="stat-card-value"><span className="value">{loadingStats ? '…' : (stats?.avgTemp ?? '—')}</span><span className="unit">°C</span></div>
                <div className="stat-card-trend stable">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="1" y1="12" x2="23" y2="12"></line></svg>
                  <span>{stats?.count ? `${stats.count} samples` : 'Awaiting data'}</span>
                </div>
              </div>
              <div className="analytics-stat-card">
                <div className="stat-card-label">AVG pH LEVEL</div>
                <div className="stat-card-value"><span className="value">{loadingStats ? '…' : (stats?.avgPh ?? '—')}</span><span className="unit">pH</span></div>
                <div className="stat-card-trend stable">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="1" y1="12" x2="23" y2="12"></line></svg>
                  <span>{stats?.count ? `${stats.count} samples` : 'Awaiting data'}</span>
                </div>
              </div>
              <div className="analytics-stat-card">
                <div className="stat-card-label">AVG SALINITY</div>
                <div className="stat-card-value"><span className="value">{loadingStats ? '…' : (stats?.avgSal ?? '—')}</span><span className="unit">ppt</span></div>
                <div className="stat-card-trend stable">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="1" y1="12" x2="23" y2="12"></line></svg>
                  <span>{stats?.count ? `${stats.count} samples` : 'Awaiting data'}</span>
                </div>
              </div>
              <div className="analytics-stat-card">
                <div className="stat-card-label">AVG TURBIDITY</div>
                <div className="stat-card-value"><span className="value">{loadingStats ? '…' : (stats?.avgTurb ?? '—')}</span><span className="unit">NTU</span></div>
                <div className="stat-card-trend stable">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="1" y1="12" x2="23" y2="12"></line></svg>
                  <span>{stats?.count ? `${stats.count} samples` : 'Awaiting data'}</span>
                </div>
              </div>
            </div>

            <div className="analytics-charts-grid">
              <div className="chart-container analytics-chart-large">
                <div className="chart-header">
                  <h2>Water Quality Trends</h2>
                  <div className="chart-legend">
                    <span className="legend-item"><span className="legend-dot" style={{ backgroundColor: '#3b82f6' }}></span> Temperature</span>
                    <span className="legend-item"><span className="legend-dot" style={{ backgroundColor: '#22c55e' }}></span> pH</span>
                    <span className="legend-item"><span className="legend-dot" style={{ backgroundColor: '#f59e0b' }}></span> Salinity</span>
                    <span className="legend-item"><span className="legend-dot" style={{ backgroundColor: '#ef4444' }}></span> Turbidity</span>
                  </div>
                </div>
                <div className="chart-area">
                  <iframe src={`${process.env.NEXT_PUBLIC_GRAFANA_URL || 'http://localhost:3000'}/d-solo/bmonitor-main/water-quality?orgId=1&panelId=1&theme=light&kiosk`} width="100%" height="100%" frameBorder="0"></iframe>
                </div>
              </div>
              <div className="chart-container analytics-chart-medium">
                <div className="chart-header"><h2>Parameter Correlation</h2></div>
                <div className="chart-area">
                  <iframe src={`${process.env.NEXT_PUBLIC_GRAFANA_URL || 'http://localhost:3000'}/d-solo/bmonitor-main/water-quality?orgId=1&panelId=2&theme=light&kiosk`} width="100%" height="100%" frameBorder="0"></iframe>
                </div>
              </div>
              <div className="chart-container analytics-chart-medium">
                <div className="chart-header"><h2>Alert Frequency</h2></div>
                <div className="chart-area">
                  <iframe src={`${process.env.NEXT_PUBLIC_GRAFANA_URL || 'http://localhost:3000'}/d-solo/bmonitor-main/water-quality?orgId=1&panelId=3&theme=light&kiosk`} width="100%" height="100%" frameBorder="0"></iframe>
                </div>
              </div>
            </div>

            <div className="data-table-container">
              <div className="table-title-bar"><h2>Data Summary — By Node</h2></div>
              <table className="data-table">
                <thead>
                  <tr><th>NODE</th><th>AVG TEMP (°C)</th><th>AVG pH</th><th>AVG SALINITY (ppt)</th><th>AVG TURBIDITY (NTU)</th><th>ALERTS</th><th>STATUS</th></tr>
                </thead>
                <tbody>
                  <tr><td className="fw-500">Alpha-Node-01</td><td>24.2</td><td>7.1</td><td>22.5</td><td>11.3</td><td>2</td><td><div className="status-indicator"><div className="status-dot active"></div><span>Normal</span></div></td></tr>
                  <tr><td className="fw-500">Beta-Node-04</td><td>25.1</td><td>7.3</td><td>23.1</td><td>14.7</td><td>5</td><td><div className="status-indicator"><div className="status-dot active"></div><span>Normal</span></div></td></tr>
                  <tr><td className="fw-500">Delta-Node-09</td><td>—</td><td>—</td><td>—</td><td>—</td><td>12</td><td><div className="status-indicator"><div className="status-dot offline"></div><span>Offline</span></div></td></tr>
                  <tr><td className="fw-500">Gamma-Node-02</td><td>23.8</td><td>7.0</td><td>21.9</td><td>10.1</td><td>0</td><td><div className="status-indicator"><div className="status-dot active"></div><span>Normal</span></div></td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
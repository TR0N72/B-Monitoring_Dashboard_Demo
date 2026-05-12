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

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [authLoading, isAuthenticated, router]);

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
                <div className="stat-card-value"><span className="value">24.3</span><span className="unit">°C</span></div>
                <div className="stat-card-trend positive">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>
                  +0.4% from last period
                </div>
              </div>
              <div className="analytics-stat-card">
                <div className="stat-card-label">AVG pH LEVEL</div>
                <div className="stat-card-value"><span className="value">7.2</span><span className="unit">pH</span></div>
                <div className="stat-card-trend stable">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="1" y1="12" x2="23" y2="12"></line></svg>
                  Stable
                </div>
              </div>
              <div className="analytics-stat-card">
                <div className="stat-card-label">AVG SALINITY</div>
                <div className="stat-card-value"><span className="value">22.8</span><span className="unit">ppt</span></div>
                <div className="stat-card-trend negative">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"></polyline><polyline points="17 18 23 18 23 12"></polyline></svg>
                  -1.2% from last period
                </div>
              </div>
              <div className="analytics-stat-card">
                <div className="stat-card-label">AVG TURBIDITY</div>
                <div className="stat-card-value"><span className="value">12.4</span><span className="unit">NTU</span></div>
                <div className="stat-card-trend positive">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>
                  +2.1% from last period
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
                <div className="chart-area"><span className="chart-placeholder">[Grafana Embedded Chart — Water Quality Trends]</span></div>
              </div>
              <div className="chart-container analytics-chart-medium">
                <div className="chart-header"><h2>Parameter Correlation</h2></div>
                <div className="chart-area"><span className="chart-placeholder">[Grafana Embedded Chart — Scatter/Heatmap]</span></div>
              </div>
              <div className="chart-container analytics-chart-medium">
                <div className="chart-header"><h2>Alert Frequency</h2></div>
                <div className="chart-area"><span className="chart-placeholder">[Grafana Embedded Chart — Bar Chart]</span></div>
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
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import Sidebar from '@/components/Sidebar';
import TopAppBar from '@/components/TopAppBar';
import AlertBanner from '@/components/AlertBanner';
import MetricCard from '@/components/MetricCard';

export default function DashboardPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { apiFetch } = useApi();
  const router = useRouter();
  const [sensorData, setSensorData] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loadingData, setLoadingData] = useState(true);

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
          apiFetch('/api/logs?limit=5'),
        ]);

        if (sensorRes.status === 'fulfilled' && sensorRes.value.ok) {
          const data = await sensorRes.value.json();
          setSensorData(data);
        }

        if (logsRes.status === 'fulfilled' && logsRes.value.ok) {
          const data = await logsRes.value.json();
          setLogs(data.logs || data || []);
        }
      } catch (err) {
        console.error('Failed to fetch dashboard data:', err);
      } finally {
        setLoadingData(false);
      }
    }

    fetchData();
  }, [isAuthenticated, apiFetch]);

  if (authLoading) return null;
  if (!isAuthenticated) return null;

  const temp = sensorData?.suhu ?? 24.5;
  const ph = sensorData?.ph ?? 7.2;
  const salinity = sensorData?.salinitas ?? 32.1;
  const turbidity = sensorData?.kekeruhan ?? 18.4;
  const isTurbidityDanger = turbidity > 15;

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
                <button className="control-btn outline">
                  <div className="btn-icon">
                    <img src="/assets/78ae8b57bff3076f255b8b5e1fec2ccd53b32508.svg" alt="Color Mode" />
                  </div>
                  <span>Color Mode</span>
                </button>
                <button className="control-btn solid">
                  <div className="btn-icon">
                    <img src="/assets/8b9e5a6b17142aaccf9de7da53652d2c80a0ae45.svg" alt="Table Mode" />
                  </div>
                  <span>Table Mode</span>
                </button>
              </div>
            </div>

            <div className="metric-cards-grid">
              <MetricCard label="TEMPERATURE" value={temp} unit="°C" icon="/assets/aa1f13350a63705391a2fd719fbfea1ec8a0d775.svg" fillWidth="65%" fillColor="var(--progress-fill-blue)" />
              <MetricCard label="PH LEVEL" value={ph} icon="/assets/175d2836fad0f392a3e0301c7f021e3b9233f740.svg" fillWidth="50%" fillColor="var(--progress-fill-green)" />
              <MetricCard label="SALINITY" value={salinity} unit="ppt" icon="/assets/aa1f13350a63705391a2fd719fbfea1ec8a0d775.svg" fillWidth="80%" fillColor="var(--progress-fill-blue)" />
              <MetricCard label="TURBIDITY" value={turbidity} unit="NTU" isDanger={isTurbidityDanger} fillWidth="95%" />
            </div>

            <div className="chart-container">
              <div className="chart-header">
                <h2>Live Telemetry (Last 24h)</h2>
              </div>
              <div className="chart-area">
                <iframe
                  src={`${process.env.NEXT_PUBLIC_GRAFANA_URL || 'http://localhost:3000'}/d-solo/bmonitor-telemetry?orgId=1&panelId=1&theme=light`}
                  width="100%"
                  height="100%"
                  frameBorder="0"
                  style={{ border: 'none', borderRadius: '2px' }}
                  title="Grafana Telemetry Chart"
                  onError={(e) => { e.target.style.display = 'none'; }}
                ></iframe>
                <p className="chart-placeholder" style={{ position: 'absolute' }}>[Grafana Stacked Chart — Configure dashboard URL]</p>
              </div>
            </div>

            <div className="data-table-container">
              <div className="table-header-section">
                <h2>Historical Logs</h2>
                <div className="table-info">
                  <p>Showing last {logs.length || 5} entries</p>
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
                    {logs.length > 0 ? logs.map((log, i) => (
                      <tr key={i}>
                        <td>{new Date(log.recorded_at || log.created_at).toLocaleString()}</td>
                        <td>{log.suhu ?? '—'}</td>
                        <td>{log.ph ?? '—'}</td>
                        <td>{log.salinitas ?? '—'}</td>
                        <td className={log.kekeruhan > 15 ? 'warning-text' : ''}>{log.kekeruhan ?? '—'}</td>
                        <td>
                          <span className={`status-badge ${log.kekeruhan > 15 ? 'warning' : 'normal'}`}>
                            {log.kekeruhan > 15 ? 'Warning' : 'Normal'}
                          </span>
                        </td>
                      </tr>
                    )) : (
                      <>
                        <tr><td>2023-10-27 14:30:00</td><td>24.5</td><td>7.2</td><td>32.1</td><td className="warning-text">18.4</td><td><span className="status-badge warning">Warning</span></td></tr>
                        <tr><td>2023-10-27 14:15:00</td><td>24.4</td><td>7.2</td><td>32.0</td><td>15.2</td><td><span className="status-badge normal">Normal</span></td></tr>
                        <tr><td>2023-10-27 14:00:00</td><td>24.4</td><td>7.3</td><td>32.0</td><td>14.8</td><td><span className="status-badge normal">Normal</span></td></tr>
                      </>
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
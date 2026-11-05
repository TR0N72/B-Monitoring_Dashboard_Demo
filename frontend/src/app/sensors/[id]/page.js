'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import Sidebar from '@/components/Sidebar';
import TopAppBar from '@/components/TopAppBar';

export default function NodeDetailsPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { apiFetch } = useApi();
  const router = useRouter();
  const params = useParams();
  const [device, setDevice] = useState(null);

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
          setDevice(data.device || data);
        }
      } catch (err) {
        console.error('Failed to fetch device:', err);
      }
    }
    fetchDevice();
  }, [isAuthenticated, params.id, apiFetch]);

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

  return (
    <div className="main-dashboard">
      <Sidebar />
      <main className="main-content">
        <div className="main-canvas">
        <TopAppBar />
        <div className="scrollable-content">
          <div className="page-header-controls">
            <div className="page-title-section">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div className="heading-1"><h1>{d.name || d.device_name || d.node_id || 'Node Details'}</h1></div>
                <div className="status-indicator-pill">
                  <div className="status-dot"></div>
                  <span>{d.status === 'offline' ? 'Offline' : 'Online'}</span>
                </div>
              </div>
              <div className="status-indicator" style={{ marginTop: '4px' }}>ESP32 Environmental Sensor • {d.location || 'B-Monitor Node'}</div>
            </div>
            <div className="page-controls">
              <button className="control-btn outline">
                <div className="btn-icon"><img src="/assets/c5950deb9f6872362bdddf0842fbe46b95b2dcca.svg" alt="Edit" /></div>
                EDIT NODE
              </button>
            </div>
          </div>
          <div className="dashboard-grid-12">
            <div className="col-span-4">
              <div className="info-card">
                <div className="info-card-header"><h2>Device Metadata</h2></div>
                <div className="info-list">
                  <div className="info-item"><span className="info-label">Node ID / MAC</span><span className="info-value mono">{d.mac_address || d.node_id || '—'}</span></div>
                  <div className="info-item"><span className="info-label">Firmware</span><span className="info-value">{d.firmware_version || d.firmware || 'v1.0.0'}</span></div>
                  <div className="info-item"><span className="info-label">Status</span><span className="info-value">{d.status || 'Active'}</span></div>
                  <div className="info-item"><span className="info-label">Last Seen</span><span className="info-value">{d.last_seen ? new Date(d.last_seen).toLocaleString() : 'Recent'}</span></div>
                </div>
              </div>
              <div className="metric-cards-2-col">
                <div className="metric-card">
                  <div className="card-header">AVG TEMP</div>
                  <div className="card-value"><span className="value">24.2</span><span className="unit">°C</span></div>
                </div>
                <div className="metric-card">
                  <div className="card-header" style={{ flexDirection: 'column' }}><span>SIGNAL</span><span>STRENGTH</span></div>
                  <div className="card-value"><span className="value">-65</span><span className="unit">dBm</span></div>
                </div>
              </div>
              <div className="info-card">
                <div className="info-card-header"><h2>Configuration Profile</h2></div>
                <div className="info-list">
                  <div className="info-item"><span className="info-label">Report Interval</span><span className="info-value">60s</span></div>
                  <div className="info-item"><span className="info-label">Deep Sleep</span><span className="info-value muted">Disabled</span></div>
                  <div className="info-item"><span className="info-label">OTA Updates</span><span className="info-value success">Enabled</span></div>
                </div>
              </div>
              <div className="info-card">
                <div className="info-card-header"><h2>Quick Actions</h2></div>
                <div className="info-list">
                  {/* Fitur belum diimplementasi (Technical Debt)
                  <button className="quick-action-btn"><span>Reboot Node</span><div className="btn-icon"><img src="/assets/3e64856e8bfd6326ac66edd772530478a0accadc.svg" alt="Reboot" /></div></button>
                  <button className="quick-action-btn"><span>Calibrate Sensors</span><div className="btn-icon"><img src="/assets/ce7fb59404067c920b4ddbce254b374c2af18a5e.svg" alt="Calibrate" /></div></button>
                  <button className="quick-action-btn"><span>View Raw Payload</span><div className="btn-icon"><img src="/assets/dab05f5c78fa58adae96e0b9e6b27a71bf6fb370.svg" alt="Code" /></div></button>
                  */}
                </div>
              </div>
            </div>
            <div className="col-span-8">
              <div className="chart-container" style={{ height: '400px', padding: '25px' }}>
                <div className="chart-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: 'none', paddingBottom: '16px' }}>
                  <h2 style={{ fontFamily: "'Manrope', sans-serif", fontSize: '20px' }}>Real-time Telemetry</h2>
                </div>
                <div className="chart-area" style={{ backgroundColor: '#f6f3f5', borderColor: '#e4e2e4' }}>
                  <span className="chart-placeholder">[Grafana Stacked Chart — Device Filtered]</span>
                </div>
              </div>
              <div className="recent-logs-card">
                <div className="recent-logs-header">
                  <h2>Recent Logs</h2>
                  {/* <a href="#" className="view-all-link">VIEW ALL</a> */}
                </div>
                <div className="recent-logs-table-container">
                  <table className="recent-logs-table">
                    <thead>
                      <tr>
                        <th style={{ width: '200px' }}>TIMESTAMP</th>
                        <th style={{ width: '107px' }}>LEVEL</th>
                        <th>MESSAGE</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td>2023-10-27 14:32:01</td><td><span className="log-badge info">INFO</span></td><td>Telemetry payload sent successfully.</td></tr>
                      <tr><td>2023-10-27 14:31:01</td><td><span className="log-badge info">INFO</span></td><td>Telemetry payload sent successfully.</td></tr>
                      <tr><td>2023-10-27 14:28:45</td><td><span className="log-badge warn">WARN</span></td><td>Signal strength dropped below threshold (-75 dBm).</td></tr>
                      <tr><td>2023-10-27 14:25:01</td><td><span className="log-badge info">INFO</span></td><td>Telemetry payload sent successfully.</td></tr>
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
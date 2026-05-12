'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import Sidebar from '@/components/Sidebar';
import TopAppBar from '@/components/TopAppBar';

export default function SensorNodesPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { apiFetch } = useApi();
  const router = useRouter();
  const [devices, setDevices] = useState([]);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!isAuthenticated) return;
    async function fetchDevices() {
      try {
        const res = await apiFetch('/api/devices');
        if (res.ok) {
          const data = await res.json();
          setDevices(data.devices || data || []);
        }
      } catch (err) {
        console.error('Failed to fetch devices:', err);
      } finally {
        setLoadingData(false);
      }
    }
    fetchDevices();
  }, [isAuthenticated, apiFetch]);

  if (authLoading || !isAuthenticated) return null;

  const fallbackDevices = [
    { id: 1, name: 'Alpha-Node-01', type: 'ESP32 Sensor', mac: '24:6F:28:A1:B2:C3', status: 'active' },
    { id: 2, name: 'Beta-Node-04', type: 'ESP32 Sensor', mac: '24:6F:28:D4:E5:F6', status: 'active' },
    { id: 3, name: 'Gateway-Main', type: 'LoRaWAN GW', mac: 'GW-8890-XYZ', status: 'active' },
    { id: 4, name: 'Delta-Node-09', type: 'ESP32 Sensor', mac: '24:6F:28:99:88:77', status: 'offline' },
    { id: 5, name: 'Gamma-Node-02', type: 'ESP32 Sensor', mac: '24:6F:28:11:22:33', status: 'active' },
  ];

  const displayDevices = devices.length > 0 ? devices : fallbackDevices;

  return (
    <div className="main-dashboard">
      <Sidebar />
      <main className="main-content">
        <div className="main-canvas">
          <TopAppBar />
          <div className="scrollable-content">
            <div className="page-header-controls">
              <div className="page-title-section">
                <div className="heading-1"><h1>Device Management</h1></div>
                <div className="status-indicator"><p>Monitor and configure hardware nodes across the network.</p></div>
              </div>
              <div className="page-controls">
                <button className="control-btn solid">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  Add Device
                </button>
              </div>
            </div>
            <div className="data-table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>DEVICE NAME</th>
                    <th>TYPE</th>
                    <th>MAC / ID</th>
                    <th>STATUS</th>
                    <th className="text-right">ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {displayDevices.map((device) => (
                    <tr key={device.id || device.device_id} className="clickable-row" onClick={() => router.push(`/sensors/${device.id || device.device_id}`)}>
                      <td className="fw-500">{device.name || device.device_name}</td>
                      <td className="text-secondary">{device.type || device.device_type || 'ESP32 Sensor'}</td>
                      <td className="mono-text">{device.mac || device.mac_address || '—'}</td>
                      <td>
                        <div className="status-indicator">
                          <div className={`status-dot ${device.status === 'offline' ? 'offline' : 'active'}`}></div>
                          <span>{device.status === 'offline' ? 'Offline' : 'Active'}</span>
                        </div>
                      </td>
                      <td className="text-right">
                        <button className="icon-btn" onClick={(e) => e.stopPropagation()}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="table-footer">
                <div>Showing {displayDevices.length} devices</div>
                <div className="button-group">
                  <button className="pagination-btn">Prev</button>
                  <button className="pagination-btn">Next</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
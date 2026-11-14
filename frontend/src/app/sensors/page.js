'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import Sidebar from '@/components/Sidebar';
import TopAppBar from '@/components/TopAppBar';

export default function SensorNodesPage() {
  const { isAuthenticated, loading: authLoading, user } = useAuth();
  const { apiFetch } = useApi();
  const router = useRouter();
  const [devices, setDevices] = useState([]);
  const [loadingData, setLoadingData] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ node_id: '', name: '', mac_address: '', lokasi: '' });
  const [formError, setFormError] = useState('');
  const isAdmin = user?.role === 'admin';

  async function loadDevices() {
    const res = await apiFetch('/api/devices');
    if (res.ok) {
      const data = await res.json();
      setDevices(data.devices || data || []);
    }
  }

  async function addDevice(e) {
    e.preventDefault();
    setFormError('');
    const res = await apiFetch('/api/devices', { method: 'POST', body: JSON.stringify(form) });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setFormError(j.error || 'Failed to add device.');
      return;
    }
    setForm({ node_id: '', name: '', mac_address: '', lokasi: '' });
    setShowForm(false);
    await loadDevices();
  }

  async function removeDevice(e, device) {
    e.stopPropagation();
    if (!window.confirm(`Delete device "${device.name || device.node_id}"? Sensor history is removed too.`)) return;
    const res = await apiFetch(`/api/devices/${device.id}`, { method: 'DELETE' });
    if (res.ok) await loadDevices();
  }

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

  const displayDevices = devices;

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
                {isAdmin && <button className="control-btn solid" onClick={() => setShowForm(v => !v)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  Add Device
                </button>}
              </div>
            </div>
            {showForm && (
              <form className="data-table-container" onSubmit={addDevice} style={{ padding: '1rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <input required placeholder="Node ID (e.g. node02)" value={form.node_id} onChange={e => setForm({ ...form, node_id: e.target.value })} />
                <input required placeholder="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                <input placeholder="MAC address" value={form.mac_address} onChange={e => setForm({ ...form, mac_address: e.target.value })} />
                <input placeholder="Location" value={form.lokasi} onChange={e => setForm({ ...form, lokasi: e.target.value })} />
                <button type="submit" className="control-btn solid">Save</button>
                {formError && <span role="alert" style={{ color: 'var(--dss-bahaya)' }}>{formError}</span>}
              </form>
            )}
            <div className="data-table-container">
              {displayDevices.length === 0 ? (
                <div style={{ padding: '3.5rem 1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  <p style={{ margin: 0, fontSize: '0.95rem' }}>No hardware nodes registered yet.</p>
                </div>
              ) : (
                <>
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
                            {isAdmin && <button className="icon-btn" aria-label={`Delete ${device.name || device.node_id}`} title="Delete device" onClick={(e) => removeDevice(e, device)}>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>
                            </button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="table-footer">
                    <div>Showing {displayDevices.length} devices</div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
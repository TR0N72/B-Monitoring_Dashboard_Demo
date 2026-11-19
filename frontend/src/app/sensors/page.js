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
  const [form, setForm] = useState({ node_id: '', name: '', mac_address: '', lokasi: '', type: 'sensor_node', status: 'offline' });
  const [formError, setFormError] = useState('');
  const [editing, setEditing] = useState(null);
  const isAdmin = user?.role === 'admin';

  async function loadDevices() {
    const res = await apiFetch('/api/devices');
    if (res.ok) {
      const data = await res.json();
      setDevices(data.devices || data || []);
    }
  }

  const emptyForm = { node_id: '', name: '', mac_address: '', lokasi: '', type: 'sensor_node', status: 'offline' };

  function startEdit(e, device) {
    e.stopPropagation();
    setEditing(device);
    setForm({
      node_id: device.node_id,
      name: device.name || '',
      mac_address: device.mac_address || '',
      lokasi: device.lokasi || '',
      type: device.type || 'sensor_node',
      status: device.status || 'offline',
    });
    setFormError('');
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditing(null);
    setForm(emptyForm);
    setFormError('');
  }

  async function saveDevice(e) {
    e.preventDefault();
    setFormError('');
    const res = editing
      ? await apiFetch(`/api/devices/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify({ name: form.name, type: form.type, status: form.status, mac_address: form.mac_address, lokasi: form.lokasi }),
        })
      : await apiFetch('/api/devices', { method: 'POST', body: JSON.stringify(form) });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setFormError(j.error || (editing ? 'Failed to update device.' : 'Failed to add device.'));
      return;
    }
    closeForm();
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
    // status online/offline berubah otomatis di backend; segarkan tiap 15 dtk
    const t = setInterval(() => { if (!document.hidden) fetchDevices(); }, 15000);
    return () => clearInterval(t);
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
                {isAdmin && <button className="control-btn solid" onClick={() => (showForm ? closeForm() : setShowForm(true))}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  Add Device
                </button>}
              </div>
            </div>
            {showForm && (
              <form className="data-table-container" onSubmit={saveDevice} style={{ padding: '1rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <input required placeholder="Node ID (e.g. node02)" aria-label="Node ID" disabled={!!editing} title={editing ? 'Node ID cannot be changed' : undefined} value={form.node_id} onChange={e => setForm({ ...form, node_id: e.target.value })} />
                <input required placeholder="Name" aria-label="Name" maxLength={100} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                <input placeholder="MAC address (AA:BB:CC:DD:EE:FF)" aria-label="MAC address" pattern="([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}" maxLength={17} value={form.mac_address} onChange={e => setForm({ ...form, mac_address: e.target.value })} />
                <input placeholder="Location" value={form.lokasi} onChange={e => setForm({ ...form, lokasi: e.target.value })} />
                {editing && (
                  <>
                    <select aria-label="Type" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                      <option value="sensor_node">Sensor node</option>
                      <option value="gateway">Gateway</option>
                    </select>
                    <select aria-label="Status" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                      <option value="online">Online</option>
                      <option value="offline">Offline</option>
                      <option value="maintenance">Maintenance</option>
                    </select>
                  </>
                )}
                <button type="submit" className="control-btn solid">{editing ? 'Update' : 'Save'}</button>
                {editing && <button type="button" className="control-btn" onClick={closeForm}>Cancel</button>}
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
                              <div className={`status-dot ${device.status === 'online' ? 'active' : 'offline'}`}></div>
                              <span>{{ online: 'Online', maintenance: 'Maintenance' }[device.status] || 'Offline'}</span>
                            </div>
                          </td>
                          <td className="text-right">
                            {isAdmin && <button className="icon-btn" aria-label={`Edit ${device.name || device.node_id}`} title="Edit device" onClick={(e) => startEdit(e, device)}>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                            </button>}
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
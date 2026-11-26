'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import Sidebar from '@/components/Sidebar';
import TopAppBar from '@/components/TopAppBar';
import Toast from '@/components/Toast';

const defaultThresholds = {
  temperature: { min: 18.5, max: 28.0 },
  salinity: { min: 10.0, max: 35.0 },
  turbidity: { min: 0.0, max: 25.0 },
};

export default function SystemConfigPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { apiFetch } = useApi();
  const router = useRouter();
  const [thresholds, setThresholds] = useState(defaultThresholds);
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [toastType, setToastType] = useState('success');
  const [toastMessage, setToastMessage] = useState('');
  const [saving, setSaving] = useState(false);

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
          const deviceList = data.devices || [];
          setDevices(deviceList);
          if (deviceList.length > 0) {
            setSelectedDeviceId(prev => prev || String(deviceList[0].id));
          }
        }
      } catch (err) {
        console.error('Failed to fetch devices:', err);
      }
    }
    fetchDevices();
  }, [isAuthenticated, apiFetch]);

  useEffect(() => {
    if (!isAuthenticated || !selectedDeviceId) return;
    async function fetchThresholds() {
      try {
        const res = await apiFetch(`/api/config/thresholds/${selectedDeviceId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.thresholds && data.thresholds.length > 0) {
            const mapped = { ...defaultThresholds };
            data.thresholds.forEach(t => {
              if (t.parameter === 'suhu') {
                mapped.temperature = { min: Number(t.batas_bawah), max: Number(t.batas_atas) };
              } else if (t.parameter === 'salinitas') {
                mapped.salinity = { min: Number(t.batas_bawah), max: Number(t.batas_atas) };
              } else if (t.parameter === 'turbidity') {
                mapped.turbidity = { min: Number(t.batas_bawah), max: Number(t.batas_atas) };
              }
            });
            setThresholds(mapped);
          } else {
            setThresholds(defaultThresholds);
          }
        } else {
          setThresholds(defaultThresholds);
        }
      } catch (err) {
        console.error('Failed to fetch thresholds:', err);
      }
    }
    fetchThresholds();
  }, [isAuthenticated, selectedDeviceId, apiFetch]);

  const updateThreshold = (param, field, value) => {
    setThresholds(prev => ({
      ...prev,
      [param]: { ...prev[param], [field]: parseFloat(value) || 0 },
    }));
  };

  const handleSave = async () => {
    if (!selectedDeviceId) {
      setToastType('error');
      setToastMessage('Please select a device first');
      setShowToast(true);
      return;
    }
    setSaving(true);
    try {
      const thresholdsArray = [
        { parameter: 'suhu', batas_bawah: thresholds.temperature.min, batas_atas: thresholds.temperature.max },
        { parameter: 'salinitas', batas_bawah: thresholds.salinity.min, batas_atas: thresholds.salinity.max },
        { parameter: 'turbidity', batas_bawah: thresholds.turbidity.min, batas_atas: thresholds.turbidity.max },
      ];
      const res = await apiFetch(`/api/config/thresholds/${selectedDeviceId}`, {
        method: 'PUT',
        body: JSON.stringify({ thresholds: thresholdsArray }),
      });
      if (res.ok) {
        setToastType('success');
        setToastMessage('Thresholds saved successfully');
      } else {
        const errData = await res.json();
        setToastType('error');
        setToastMessage(errData.error || 'Failed to save thresholds');
      }
    } catch (err) {
      setToastType('error');
      setToastMessage('Network error — could not save');
    } finally {
      setSaving(false);
      setShowToast(true);
    }
  };

  const hideToast = useCallback(() => setShowToast(false), []);

  if (authLoading || !isAuthenticated) return null;

  const cards = [
    { key: 'temperature', label: 'Temperature (°C)', icon: '/icons/temperature.svg', minMax: [0, 50] },
    { key: 'salinity', label: 'Salinity (ppt)', icon: '/icons/salinity.svg', minMax: [0, 50] },
    { key: 'turbidity', label: 'Turbidity (NTU)', icon: '/icons/turbidity.svg', minMax: [0, 1000] },
  ];

  return (
    <div className="main-dashboard">
      <Sidebar />
      <main className="main-content system-config-main">
        <div className="main-canvas">
          <TopAppBar />
          <div className="scrollable-content">
            <div className="config-panel">
              <div className="config-header">
                <h2 className="config-title">Water Quality Thresholds</h2>
                <p className="config-description">Alerts will be triggered when sensor readings fall outside these configured ranges.</p>
              </div>
              {devices.length > 0 && (
                <div className="device-selector" style={{ marginBottom: '20px' }}>
                  <label className="form-label">TARGET DEVICE</label>
                  <select
                    value={selectedDeviceId}
                    onChange={(e) => setSelectedDeviceId(e.target.value)}
                    className="device-select"
                  >
                    {devices.map(d => (
                      <option key={d.id} value={String(d.id)}>{d.name} ({d.node_id})</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="config-grid">
                {cards.map((card) => (
                  <div key={card.key} className="config-card">
                    <div className="config-card-header">
                      <img src={card.icon} alt={`${card.label} Icon`} />
                      <h3>{card.label}</h3>
                    </div>
                    <div className="config-inputs">
                      <div className="input-group">
                        <label>MIN LIMIT</label>
                        <div className="input-wrapper">
                          <input
                            type="number"
                            step="0.1"
                            value={thresholds[card.key]?.min ?? 0}
                            min={card.minMax[0]}
                            max={card.minMax[1]}
                            className="threshold-input"
                            onChange={(e) => updateThreshold(card.key, 'min', e.target.value)}
                          />
                        </div>
                      </div>
                      <div className="input-group">
                        <label>MAX LIMIT</label>
                        <div className="input-wrapper">
                          <input
                            type="number"
                            step="0.1"
                            value={thresholds[card.key]?.max ?? 0}
                            min={card.minMax[0]}
                            max={card.minMax[1]}
                            className="threshold-input"
                            onChange={(e) => updateThreshold(card.key, 'max', e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="config-footer">
                <button className="save-config-btn" onClick={handleSave} disabled={saving}>
                  <img src="/icons/save.svg" alt="Save Icon" />
                  <span>{saving ? 'Saving...' : 'Save Configuration'}</span>
                </button>
              </div>
            </div>
          </div>
          <Toast message={toastMessage} type={toastType} show={showToast} onClose={hideToast} />
        </div>
      </main>
    </div>
  );
}
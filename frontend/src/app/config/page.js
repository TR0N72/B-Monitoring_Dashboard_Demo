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
  ph: { min: 6.5, max: 8.5 },
  salinity: { min: 10.0, max: 35.0 },
  turbidity: { min: 0.0, max: 25.0 },
};

export default function SystemConfigPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { apiFetch } = useApi();
  const router = useRouter();
  const [thresholds, setThresholds] = useState(defaultThresholds);
  const [showToast, setShowToast] = useState(false);
  const [toastType, setToastType] = useState('success');
  const [toastMessage, setToastMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!isAuthenticated) return;
    async function fetchThresholds() {
      try {
        const res = await apiFetch('/api/config/thresholds');
        if (res.ok) {
          const data = await res.json();
          if (data.thresholds && data.thresholds.length > 0) {
            const mapped = {};
            data.thresholds.forEach(t => {
              mapped[t.parameter] = { min: t.batas_bawah, max: t.batas_atas };
            });
            setThresholds(prev => ({ ...prev, ...mapped }));
          }
        }
      } catch (err) {
        console.error('Failed to fetch thresholds:', err);
      }
    }
    fetchThresholds();
  }, [isAuthenticated, apiFetch]);

  const updateThreshold = (param, field, value) => {
    setThresholds(prev => ({
      ...prev,
      [param]: { ...prev[param], [field]: parseFloat(value) || 0 },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await apiFetch('/api/config/thresholds', {
        method: 'PUT',
        body: JSON.stringify({ thresholds }),
      });
      if (res.ok) {
        setToastType('success');
        setToastMessage('Thresholds saved successfully');
      } else {
        setToastType('error');
        setToastMessage('Failed to save thresholds');
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
    { key: 'temperature', label: 'Temperature (°C)', icon: '/assets/6f3510a1dbb99babca2e52252df845e0f6a7941e.svg', minMax: [0, 50] },
    { key: 'ph', label: 'pH Level', icon: '/assets/7cbc8d37ade756484e345e40d2c92b51f08d8a1d.svg', minMax: [0, 14] },
    { key: 'salinity', label: 'Salinity (ppt)', icon: '/assets/8ceabc24f95c1ef1a379cf49d24d68a56493acb4.svg', minMax: [0, 50] },
    { key: 'turbidity', label: 'Turbidity (NTU)', icon: '/assets/90dd09ce6d6dcf0865ad04a71caf4c1138acf2b1.svg', minMax: [0, 1000] },
  ];

  return (
    <div className="main-dashboard">
      <Sidebar />
      <main className="main-content system-config-main">
        <div className="main-canvas flex-center">
          <TopAppBar />
          <div className="scrollable-content flex-center">
            <div className="config-panel">
              <div className="config-header">
                <h2 className="config-title">Water Quality Thresholds</h2>
                <p className="config-description">Alerts will be triggered when sensor readings fall outside these configured ranges.</p>
              </div>
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
                  <img src="/assets/5a5d656219161cc693e96194e2cc39a73ff24e64.svg" alt="Save Icon" />
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
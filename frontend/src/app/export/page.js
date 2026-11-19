'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import Sidebar from '@/components/Sidebar';
import TopAppBar from '@/components/TopAppBar';

const parameters = [
  { key: 'suhu', label: 'Water Temperature', unit: '°C', checked: true },
  { key: 'salinitas', label: 'Salinity', unit: 'ppt', checked: true },
  { key: 'turbidity', label: 'Turbidity', unit: 'NTU', checked: true },
  { key: 'baterai', label: 'Battery Level', unit: '%', checked: true },
  { key: 'rssi', label: 'Signal Strength (RSSI)', unit: 'dBm', checked: true },
  { key: 'jarak', label: 'Water Distance', unit: 'cm', checked: true },
];

function getIsoDate(date) {
  return date.toISOString().split('T')[0];
}

export default function ExportLogsPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { apiFetch } = useApi();
  const router = useRouter();

  const [exportType, setExportType] = useState('telemetry');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return getIsoDate(d);
  });
  const [endDate, setEndDate] = useState(() => getIsoDate(new Date()));
  const [activePreset, setActivePreset] = useState('Last 7 Days');
  const [downloading, setDownloading] = useState(false);
  const [checkedParams, setCheckedParams] = useState(
    Object.fromEntries(parameters.map(p => [p.key, p.checked]))
  );

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [authLoading, isAuthenticated, router]);

  if (authLoading || !isAuthenticated) return null;

  const toggleParam = (key) => {
    setCheckedParams(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const applyPreset = (preset) => {
    setActivePreset(preset);
    const now = new Date();
    const end = getIsoDate(now);
    setEndDate(end);

    if (preset === 'Last 24h') {
      const start = new Date(now);
      start.setDate(start.getDate() - 1);
      setStartDate(getIsoDate(start));
    } else if (preset === 'Last 7 Days') {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      setStartDate(getIsoDate(start));
    } else if (preset === 'This Month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      setStartDate(getIsoDate(start));
    }
  };

  const selectedCount = Object.values(checkedParams).filter(Boolean).length;
  const daysDiff = Math.max(1, Math.round((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)));

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const cols = Object.keys(checkedParams).filter(k => checkedParams[k]).join(',');
      const res = await apiFetch(`/api/logs/export?type=${exportType}&start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}&columns=${encodeURIComponent(cols)}`);
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bmonitor-${exportType}-${startDate}-to-${endDate}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="main-dashboard">
      <Sidebar />
      <main className="main-content">
        <div className="main-canvas">
          <TopAppBar />
          <div className="scrollable-content">
            <div className="page-header-controls">
              <div className="page-title-section">
                <div className="heading-1"><h1>Export Logs</h1></div>
                <div className="status-indicator"><p>Configure dataset, parameters, and temporal range to export system logs.</p></div>
              </div>
            </div>
            <div className="dashboard-grid-3">
              <div className="col-span-2">
                <div className="info-card">
                  <div className="info-card-header"><h2>Log Dataset</h2></div>
                  <div className="button-group" style={{ marginBottom: '1.25rem' }}>
                    <button
                      className={`filter-btn ${exportType === 'telemetry' ? 'active' : ''}`}
                      onClick={() => setExportType('telemetry')}
                    >
                      Sensor Telemetry Data
                    </button>
                    <button
                      className={`filter-btn ${exportType === 'alerts' ? 'active' : ''}`}
                      onClick={() => setExportType('alerts')}
                    >
                      Threshold & System Alerts
                    </button>
                  </div>
                  <div className="info-card-header"><h2>Temporal Range</h2></div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">START DATE</label>
                      <div className="form-input-container">
                        <input
                          type="date"
                          value={startDate}
                          onChange={(e) => { setStartDate(e.target.value); setActivePreset(''); }}
                        />
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">END DATE</label>
                      <div className="form-input-container">
                        <input
                          type="date"
                          value={endDate}
                          onChange={(e) => { setEndDate(e.target.value); setActivePreset(''); }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="button-group">
                    {['Last 24h', 'Last 7 Days', 'This Month'].map(p => (
                      <button
                        key={p}
                        className={`filter-btn ${activePreset === p ? 'active' : ''}`}
                        onClick={() => applyPreset(p)}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                {exportType === 'telemetry' && (
                  <div className="info-card">
                    <div className="info-card-header"><h2>Telemetry Parameters</h2></div>
                    <div className="checkbox-grid">
                      {parameters.map((param) => (
                        <div key={param.key} className="checkbox-item" onClick={() => toggleParam(param.key)}>
                          <div className="checkbox-label">
                            <div className={`checkbox-custom ${checkedParams[param.key] ? 'checked' : ''}`}>
                              <svg className="checkbox-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                            </div>
                            <span>{param.label}</span>
                          </div>
                          <span className="checkbox-unit">{param.unit}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="col-span-1">
                <div className="info-card">
                  <div className="info-card-header"><h2>Export Summary</h2></div>
                  <div className="info-list">
                    <div className="info-item"><span className="info-label">Dataset</span><span className="info-value" style={{ textTransform: 'capitalize' }}>{exportType}</span></div>
                    <div className="info-item"><span className="info-label">Time Range</span><span className="info-value">{daysDiff} Day{daysDiff > 1 ? 's' : ''}</span></div>
                    {exportType === 'telemetry' && (
                      <div className="info-item"><span className="info-label">Parameters</span><span className="info-value">{selectedCount} Selected</span></div>
                    )}
                    <div className="info-item"><span className="info-label">Format</span><span className="info-value">CSV</span></div>
                  </div>
                  <div className="form-group export-format-group">
                    <label className="form-label">FORMAT</label>
                    <div className="form-input-container">
                      <input type="text" value="CSV (Comma Separated)" readOnly className="format-input" />
                    </div>
                  </div>
                  <button className="primary-btn" onClick={handleDownload} disabled={downloading}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                    {downloading ? 'Compiling Export…' : 'Download CSV File'}
                  </button>
                  <div className="helper-text">Large exports may take a few moments to compile.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

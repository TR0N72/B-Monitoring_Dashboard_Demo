'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import Sidebar from '@/components/Sidebar';
import TopAppBar from '@/components/TopAppBar';

const parameters = [
  { key: 'temperature', label: 'Water Temperature', unit: '°C', checked: true },
  { key: 'do', label: 'Dissolved Oxygen (DO)', unit: 'mg/L', checked: true },
  { key: 'ph', label: 'pH Level', unit: 'pH', checked: false },
  { key: 'turbidity', label: 'Turbidity', unit: 'NTU', checked: true },
  { key: 'ammonia', label: 'Ammonia (NH3)', unit: 'mg/L', checked: false },
  { key: 'salinity', label: 'Salinity', unit: 'PSU', checked: false },
];

export default function ExportLogsPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { apiFetch } = useApi();
  const router = useRouter();
  const [startDate, setStartDate] = useState('Oct 01, 2023');
  const [endDate, setEndDate] = useState('Oct 31, 2023');
  const [activePreset, setActivePreset] = useState('This Month');
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

  const selectedCount = Object.values(checkedParams).filter(Boolean).length;

  const handleDownload = async () => {
    try {
      const res = await apiFetch(`/api/logs/export?format=csv&from=${startDate}&to=${endDate}`);
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bmonitor-logs-${Date.now()}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Export failed:', err);
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
                <div className="status-indicator"><p>Configure parameters and date range to export sensor telemetry logs.</p></div>
              </div>
            </div>
            <div className="dashboard-grid-3">
              <div className="col-span-2">
                <div className="info-card">
                  <div className="info-card-header"><h2>Temporal Range</h2></div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">START DATE</label>
                      <div className="form-input-container">
                        <input type="text" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                        <div className="input-icon">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                        </div>
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">END DATE</label>
                      <div className="form-input-container">
                        <input type="text" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                        <div className="input-icon">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="button-group">
                    {['Last 24h', 'Last 7 Days', 'This Month'].map(p => (
                      <button key={p} className={`filter-btn ${activePreset === p ? 'active' : ''}`} onClick={() => setActivePreset(p)}>{p}</button>
                    ))}
                  </div>
                </div>
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
              </div>
              <div className="col-span-1">
                <div className="info-card">
                  <div className="info-card-header"><h2>Export Summary</h2></div>
                  <div className="info-list">
                    <div className="info-item"><span className="info-label">Nodes Selected</span><span className="info-value">All Active (12)</span></div>
                    <div className="info-item"><span className="info-label">Time Range</span><span className="info-value">31 Days</span></div>
                    <div className="info-item"><span className="info-label">Parameters</span><span className="info-value">{selectedCount} Selected</span></div>
                    <div className="info-item"><span className="info-label">Est. Rows</span><span className="info-value">~44,640</span></div>
                  </div>
                  <div className="form-group export-format-group">
                    <label className="form-label">FORMAT</label>
                    <div className="form-input-container">
                      <input type="text" value="CSV (Comma Separated)" readOnly className="format-input" />
                      <div className="input-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                      </div>
                    </div>
                  </div>
                  <button className="primary-btn" onClick={handleDownload}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                    Download Log File
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
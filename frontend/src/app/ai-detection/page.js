'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import { useSocket } from '@/hooks/useSocket';
import Sidebar from '@/components/Sidebar';
import TopAppBar from '@/components/TopAppBar';

const labelConfig = {
  sehat: { color: 'var(--dss-aman)', icon: '🐟', bgClass: 'ai-label-sehat' },
  sakit: { color: 'var(--dss-waspada)', icon: '⚠', bgClass: 'ai-label-sakit' },
  mati: { color: 'var(--dss-bahaya)', icon: '✕', bgClass: 'ai-label-mati' },
};

function StatCard({ label, value, subtext, icon, colorClass }) {
  return (
    <div className={`ai-stat-card ${colorClass}`}>
      <div className="ai-stat-icon">{icon}</div>
      <div className="ai-stat-info">
        <div className="ai-stat-value">{value}</div>
        <div className="ai-stat-label">{label}</div>
        {subtext && <div className="ai-stat-subtext">{subtext}</div>}
      </div>
    </div>
  );
}

export default function AIDetectionPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { apiFetch } = useApi();
  const { subscribe, connected } = useSocket();
  const router = useRouter();
  const [detections, setDetections] = useState([]);
  const [loadingData, setLoadingData] = useState(true);
  const [filterLabel, setFilterLabel] = useState('all');

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [authLoading, isAuthenticated, router]);

  const fetchDetections = useCallback(async () => {
    try {
      let url = '/api/ai-detection';
      if (filterLabel !== 'all') url += `?label=${filterLabel}`;
      const res = await apiFetch(url);
      if (res.ok) {
        const json = await res.json();
        setDetections(json.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch AI detections:', err);
    } finally {
      setLoadingData(false);
    }
  }, [apiFetch, filterLabel]);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchDetections();
  }, [isAuthenticated, fetchDetections]);

  // Real-time AI detection events
  useEffect(() => {
    if (!isAuthenticated) return;
    const unsub = subscribe('ai:detection', (data) => {
      setDetections(prev => [data, ...prev].slice(0, 100));
    });
    return unsub;
  }, [isAuthenticated, subscribe]);

  if (authLoading || !isAuthenticated) return null;

  // Fallback demo data
  const displayDetections = detections.length > 0 ? detections : [
    { id: 1, node_id: 'ESP32-NODE-01', label: 'sehat', confidence: 0.94, model_version: 'v2.1.0', hsv_metadata: '{"h_mean":85,"s_mean":120,"v_mean":180}', created_at: new Date(Date.now() - 180000).toISOString() },
    { id: 2, node_id: 'ESP32-NODE-01', label: 'sakit', confidence: 0.78, model_version: 'v2.1.0', hsv_metadata: '{"h_mean":35,"s_mean":90,"v_mean":150}', created_at: new Date(Date.now() - 480000).toISOString() },
    { id: 3, node_id: 'ESP32-NODE-03', label: 'sehat', confidence: 0.91, model_version: 'v2.1.0', hsv_metadata: '{"h_mean":82,"s_mean":115,"v_mean":175}', created_at: new Date(Date.now() - 720000).toISOString() },
    { id: 4, node_id: 'ESP32-NODE-01', label: 'mati', confidence: 0.88, model_version: 'v2.1.0', hsv_metadata: '{"h_mean":15,"s_mean":45,"v_mean":100}', created_at: new Date(Date.now() - 1200000).toISOString() },
  ];

  // Stats
  const totalDetections = displayDetections.length;
  const countByLabel = displayDetections.reduce((acc, d) => {
    const l = (d.label || '').toLowerCase();
    acc[l] = (acc[l] || 0) + 1;
    return acc;
  }, {});
  const avgConfidence = totalDetections > 0
    ? (displayDetections.reduce((sum, d) => sum + (d.confidence || 0), 0) / totalDetections * 100).toFixed(1)
    : '—';

  const parseHSV = (metadata) => {
    try {
      if (typeof metadata === 'string') return JSON.parse(metadata);
      return metadata || {};
    } catch { return {}; }
  };

  const getConfidenceColor = (conf) => {
    if (conf >= 0.85) return 'var(--dss-aman)';
    if (conf >= 0.6) return 'var(--dss-waspada)';
    return 'var(--dss-bahaya)';
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
                <div className="heading-1"><h1>AI Visual Detection</h1></div>
                <div className="status-indicator">
                  <div className={`status-dot ${connected ? 'active' : 'offline'}`}></div>
                  <p>{connected ? 'Live Detection Feed' : 'Connecting...'}</p>
                </div>
              </div>
              <div className="page-controls">
                <div className="button-group">
                  {['all', 'sehat', 'sakit', 'mati'].map((f) => (
                    <button
                      key={f}
                      className={`filter-btn ${filterLabel === f ? 'active' : ''}`}
                      onClick={() => setFilterLabel(f)}
                    >
                      {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Stat Cards */}
            <div className="ai-stats-grid">
              <StatCard
                label="Total Detections"
                value={totalDetections}
                icon="📊"
                colorClass="ai-stat-total"
              />
              <StatCard
                label="Sehat (Healthy)"
                value={countByLabel.sehat || 0}
                subtext={totalDetections > 0 ? `${((countByLabel.sehat || 0) / totalDetections * 100).toFixed(0)}%` : '—'}
                icon="🐟"
                colorClass="ai-stat-sehat"
              />
              <StatCard
                label="Sakit (Sick)"
                value={countByLabel.sakit || 0}
                subtext={totalDetections > 0 ? `${((countByLabel.sakit || 0) / totalDetections * 100).toFixed(0)}%` : '—'}
                icon="⚠"
                colorClass="ai-stat-sakit"
              />
              <StatCard
                label="Mati (Dead)"
                value={countByLabel.mati || 0}
                subtext={totalDetections > 0 ? `${((countByLabel.mati || 0) / totalDetections * 100).toFixed(0)}%` : '—'}
                icon="✕"
                colorClass="ai-stat-mati"
              />
              <StatCard
                label="Avg Confidence"
                value={`${avgConfidence}%`}
                icon="🎯"
                colorClass="ai-stat-confidence"
              />
            </div>

            {/* Detection History */}
            <div className="data-table-container">
              <div className="table-header-section">
                <h2>Detection History</h2>
                <div className="table-info">
                  <p>{displayDetections.length} records</p>
                </div>
              </div>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>TIMESTAMP</th>
                      <th>NODE</th>
                      <th>LABEL</th>
                      <th>CONFIDENCE</th>
                      <th>MODEL</th>
                      <th>HSV DATA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayDetections.map((det, i) => {
                      const lbl = (det.label || '').toLowerCase();
                      const conf = det.confidence || 0;
                      const hsv = parseHSV(det.hsv_metadata);
                      const cfg = labelConfig[lbl] || labelConfig.sehat;

                      return (
                        <tr key={det.id || i}>
                          <td>{new Date(det.created_at).toLocaleString()}</td>
                          <td className="fw-500">{det.node_id || `Device-${det.device_id}`}</td>
                          <td>
                            <span className={`ai-label-badge ${cfg.bgClass}`}>
                              {cfg.icon} {det.label}
                            </span>
                          </td>
                          <td>
                            <div className="ai-confidence-cell">
                              <div className="ai-confidence-bar">
                                <div className="ai-confidence-fill" style={{
                                  width: `${conf * 100}%`,
                                  backgroundColor: getConfidenceColor(conf),
                                }} />
                              </div>
                              <span>{(conf * 100).toFixed(1)}%</span>
                            </div>
                          </td>
                          <td className="mono-text">{det.model_version || '—'}</td>
                          <td className="mono-text ai-hsv-cell">
                            {hsv.h_mean !== undefined ? (
                              <span>H:{hsv.h_mean} S:{hsv.s_mean} V:{hsv.v_mean}</span>
                            ) : '—'}
                          </td>
                        </tr>
                      );
                    })}
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

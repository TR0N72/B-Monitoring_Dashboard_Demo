'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import { useSocket } from '@/hooks/useSocket';
import Sidebar from '@/components/Sidebar';
import TopAppBar from '@/components/TopAppBar';

function ScoreGauge({ score, recommendation }) {
  const getColor = (rec) => {
    if (rec === 'Aman') return 'var(--dss-aman)';
    if (rec === 'Waspada') return 'var(--dss-waspada)';
    return 'var(--dss-bahaya)';
  };

  const color = getColor(recommendation);
  const rotation = (score / 100) * 180 - 90;

  return (
    <div className="dss-gauge-container">
      <div className="dss-gauge">
        <svg viewBox="0 0 200 120" className="dss-gauge-svg">
          <defs>
            <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="var(--dss-aman)" />
              <stop offset="50%" stopColor="var(--dss-waspada)" />
              <stop offset="100%" stopColor="var(--dss-bahaya)" />
            </linearGradient>
          </defs>
          <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="var(--card-border)" strokeWidth="12" strokeLinecap="round" />
          <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="url(#gaugeGrad)" strokeWidth="12" strokeLinecap="round"
            strokeDasharray={`${(score / 100) * 251.2} 251.2`} />
          <line x1="100" y1="100" x2="100" y2="30" stroke={color} strokeWidth="3" strokeLinecap="round"
            transform={`rotate(${rotation}, 100, 100)`} className="dss-gauge-needle" />
          <circle cx="100" cy="100" r="6" fill={color} />
        </svg>
        <div className="dss-gauge-value" style={{ color }}>{score?.toFixed(1) ?? '—'}</div>
        <div className="dss-gauge-label">DSS Score</div>
      </div>
    </div>
  );
}

function MembershipBar({ label, memberships, colorMap }) {
  const entries = Object.entries(memberships || {});
  const dominant = entries.reduce((a, b) => (b[1] > a[1] ? b : a), ['', 0]);

  return (
    <div className="membership-bar-card">
      <div className="membership-bar-header">
        <span className="membership-bar-label">{label}</span>
        <span className="membership-bar-dominant">{dominant[0]}</span>
      </div>
      <div className="membership-bar-tracks">
        {entries.map(([name, value]) => (
          <div key={name} className="membership-track">
            <div className="membership-track-label">
              <span>{name}</span>
              <span>{(value * 100).toFixed(0)}%</span>
            </div>
            <div className="membership-track-bg">
              <div className="membership-track-fill" style={{
                width: `${value * 100}%`,
                backgroundColor: colorMap[name] || 'var(--accent-blue)',
              }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DSSPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { apiFetch } = useApi();
  const { subscribe, connected } = useSocket();
  const router = useRouter();
  const [history, setHistory] = useState([]);
  const [latestDSS, setLatestDSS] = useState(null);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [authLoading, isAuthenticated, router]);

  const fetchDSSHistory = useCallback(async () => {
    try {
      const res = await apiFetch('/api/dss?limit=50');
      if (res.ok) {
        const json = await res.json();
        const data = json.data || [];
        setHistory(data);
        if (data.length > 0) {
          setLatestDSS(data[0]);
        }
      }
    } catch (err) {
      console.error('Failed to fetch DSS history:', err);
    } finally {
      setLoadingData(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchDSSHistory();
  }, [isAuthenticated, fetchDSSHistory]);

  // Real-time DSS updates
  useEffect(() => {
    if (!isAuthenticated) return;
    const unsub = subscribe('dss:update', (data) => {
      setLatestDSS(data);
      setHistory(prev => [data, ...prev].slice(0, 50));
    });
    return unsub;
  }, [isAuthenticated, subscribe]);

  if (authLoading || !isAuthenticated) return null;

  const recommendation = latestDSS?.recommendation || latestDSS?.dss_recommendation || '—';
  const score = latestDSS?.score ?? latestDSS?.dss_score ?? 0;
  const suhuMem = latestDSS?.suhu_membership || '—';
  const salMem = latestDSS?.salinitas_membership || '—';
  const firedRules = (() => {
    try {
      if (typeof latestDSS?.fired_rules === 'string') return JSON.parse(latestDSS.fired_rules);
      return latestDSS?.fired_rules || [];
    } catch { return []; }
  })();

  const getStatusClass = (rec) => {
    if (rec === 'Aman') return 'status-aman';
    if (rec === 'Waspada') return 'status-waspada';
    return 'status-bahaya';
  };

  // Fallback data for demo
  const displayHistory = history.length > 0 ? history : [
    { id: 1, node_id: 'ESP32-NODE-01', suhu_membership: 'normal', salinitas_membership: 'normal', dss_score: 25.0, dss_recommendation: 'Aman', created_at: new Date(Date.now() - 300000).toISOString() },
    { id: 2, node_id: 'ESP32-NODE-01', suhu_membership: 'panas', salinitas_membership: 'tinggi', dss_score: 68.5, dss_recommendation: 'Waspada', created_at: new Date(Date.now() - 600000).toISOString() },
    { id: 3, node_id: 'ESP32-NODE-03', suhu_membership: 'dingin', salinitas_membership: 'rendah', dss_score: 75.0, dss_recommendation: 'Bahaya', created_at: new Date(Date.now() - 900000).toISOString() },
  ];

  return (
    <div className="main-dashboard">
      <Sidebar />
      <main className="main-content">
        <div className="main-canvas">
          <TopAppBar />
          <div className="scrollable-content">
            <div className="page-header-controls">
              <div className="page-title-section">
                <div className="heading-1"><h1>Decision Support System</h1></div>
                <div className="status-indicator">
                  <div className={`status-dot ${connected ? 'active' : 'offline'}`}></div>
                  <p>{connected ? 'Real-time Connected' : 'Connecting...'}</p>
                </div>
              </div>
            </div>

            {/* DSS Score + Status */}
            <div className="dss-top-grid">
              <div className="dss-score-card">
                <ScoreGauge score={score} recommendation={recommendation} />
                <div className={`dss-status-badge ${getStatusClass(recommendation)}`}>
                  <span className="dss-status-icon">
                    {recommendation === 'Aman' ? '✓' : recommendation === 'Waspada' ? '⚠' : '✕'}
                  </span>
                  <span>{recommendation}</span>
                </div>
                <p className="dss-score-subtext">Fuzzy Mamdani Evaluation</p>
              </div>

              <div className="dss-membership-cards">
                <div className="dss-mem-card">
                  <div className="dss-mem-card-header">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"></path></svg>
                    <span>Suhu (Temperature)</span>
                  </div>
                  <div className="dss-mem-value">{suhuMem}</div>
                  <div className="dss-mem-bar-group">
                    {['dingin', 'normal', 'panas'].map(m => (
                      <div key={m} className={`dss-mem-indicator ${suhuMem === m ? 'active' : ''}`}>
                        <div className="dss-mem-dot" style={{ backgroundColor: suhuMem === m ? (m === 'normal' ? 'var(--dss-aman)' : m === 'dingin' ? 'var(--accent-blue)' : 'var(--dss-bahaya)') : 'var(--card-border)' }}></div>
                        <span>{m}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="dss-mem-card">
                  <div className="dss-mem-card-header">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path></svg>
                    <span>Salinitas (Salinity)</span>
                  </div>
                  <div className="dss-mem-value">{salMem}</div>
                  <div className="dss-mem-bar-group">
                    {['rendah', 'normal', 'tinggi'].map(m => (
                      <div key={m} className={`dss-mem-indicator ${salMem === m ? 'active' : ''}`}>
                        <div className="dss-mem-dot" style={{ backgroundColor: salMem === m ? (m === 'normal' ? 'var(--dss-aman)' : m === 'rendah' ? 'var(--accent-blue)' : 'var(--dss-bahaya)') : 'var(--card-border)' }}></div>
                        <span>{m}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="dss-rules-card">
                <h3>Active Rules</h3>
                {firedRules.length > 0 ? (
                  <div className="dss-rules-list">
                    {firedRules.map((r, i) => (
                      <div key={i} className="dss-rule-item">
                        <div className={`dss-rule-badge ${getStatusClass(r.output_label)}`}>{r.output_label}</div>
                        <div className="dss-rule-weight">
                          <div className="dss-rule-weight-bar">
                            <div className="dss-rule-weight-fill" style={{ width: `${(r.weight || 0) * 100}%` }}></div>
                          </div>
                          <span>{((r.weight || 0) * 100).toFixed(0)}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="dss-rules-empty">
                    <p>No active rules — waiting for sensor data</p>
                  </div>
                )}
              </div>
            </div>

            {/* DSS History Table */}
            <div className="data-table-container">
              <div className="table-header-section">
                <h2>DSS Evaluation History</h2>
                <div className="table-info">
                  <p>Showing last {displayHistory.length} evaluations</p>
                </div>
              </div>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>TIMESTAMP</th>
                      <th>NODE</th>
                      <th>SUHU MEM.</th>
                      <th>SALINITAS MEM.</th>
                      <th>SCORE</th>
                      <th>RECOMMENDATION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayHistory.map((item, i) => {
                      const rec = item.dss_recommendation || item.recommendation || '—';
                      return (
                        <tr key={item.id || i}>
                          <td>{new Date(item.created_at).toLocaleString()}</td>
                          <td className="fw-500">{item.node_id || `Device-${item.device_id}`}</td>
                          <td><span className="dss-mem-chip">{item.suhu_membership}</span></td>
                          <td><span className="dss-mem-chip">{item.salinitas_membership}</span></td>
                          <td className="fw-500">{(item.dss_score ?? item.score)?.toFixed(1)}</td>
                          <td>
                            <span className={`status-badge ${getStatusClass(rec)}`}>{rec}</span>
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

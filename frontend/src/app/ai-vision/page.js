'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useApi } from '@/hooks/useApi';
import { useSocket } from '@/hooks/useSocket';
import Sidebar from '@/components/Sidebar';
import TopAppBar from '@/components/TopAppBar';

const MAX_BYTES = 5 * 1024 * 1024;
const badgeClass = (l) => (l === 'Normal' ? 'status-aman' : l === 'Caution' ? 'status-waspada' : 'status-bahaya');

export default function AIVisionPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { apiFetch } = useApi();
  const { subscribe } = useSocket();
  const router = useRouter();
  const [devices, setDevices] = useState([]);
  const [nodeId, setNodeId] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let ignore = false;
    (async () => {
      try {
        const [d, h] = await Promise.all([apiFetch('/api/devices'), apiFetch('/api/ai/detections?limit=20')]);
        if (ignore) return;
        if (d.ok) {
          const j = await d.json();
          const list = j.devices || j.data || [];
          setDevices(list);
          setNodeId((prev) => prev || list[0]?.node_id || '');
        }
        if (h.ok) setHistory((await h.json()).data || []);
      } catch (e) { console.error('[AI Vision] load failed:', e); }
    })();
    return () => { ignore = true; };
  }, [isAuthenticated, apiFetch]);

  useEffect(() => {
    if (!isAuthenticated) return;
    return subscribe('ai:detection', (d) => setHistory((prev) => [d, ...prev.filter((x) => x.id !== d.id)].slice(0, 20)));
  }, [isAuthenticated, subscribe]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const pick = (e) => {
    const f = e.target.files?.[0] || null;
    setResult(null);
    if (f && !/^image\/(jpeg|png)$/.test(f.type)) { setError('Use a JPEG or PNG image.'); setFile(null); setPreview(null); return; }
    if (f && f.size > MAX_BYTES) { setError('Image is larger than 5 MB.'); setFile(null); setPreview(null); return; }
    setError('');
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : null);
  };

  const analyze = useCallback(async () => {
    if (!file || !nodeId) return;
    setBusy(true); setError(''); setResult(null);
    try {
      const res = await apiFetch(`/api/ai/analyze?node_id=${encodeURIComponent(nodeId)}`, {
        method: 'POST', headers: { 'Content-Type': file.type }, body: file,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      setResult(json.data);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }, [file, nodeId, apiFetch]);

  if (authLoading || !isAuthenticated) return null;

  return (
    <div className="main-dashboard">
      <Sidebar />
      <main className="main-content">
        <div className="main-canvas">
          <TopAppBar />
          <div className="scrollable-content">
            <div className="page-header-controls">
              <div className="page-title-section">
                <div className="heading-1"><h1>AI Vision</h1></div>
              </div>
            </div>

            <div className="aiv-panel">
              <div className="aiv-form">
                <label htmlFor="aiv-node">Node</label>
                <select id="aiv-node" value={nodeId} onChange={(e) => setNodeId(e.target.value)}>
                  {devices.map((d) => <option key={d.id} value={d.node_id}>{d.node_id}{d.name ? ` — ${d.name}` : ''}</option>)}
                </select>
                <label htmlFor="aiv-file">Water photo (JPEG or PNG, max 5 MB)</label>
                <input id="aiv-file" type="file" accept="image/jpeg,image/png" onChange={pick} />
                <button className="aiv-btn" onClick={analyze} disabled={!file || !nodeId || busy}>
                  {busy ? 'Analyzing…' : 'Analyze image'}
                </button>
                <div role="alert" className="aiv-error">{error}</div>
              </div>
              <div className="aiv-preview" aria-live="polite">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {preview && <img src={preview} alt="Selected water sample" />}
                {result && (
                  <p>
                    <span className={`dss-status-badge ${badgeClass(result.label)}`}>{result.label}</span>
                    {' '}{(result.confidence * 100).toFixed(1)}% confidence
                    {result.hsv_metadata?.predicted_class ? ` · ${result.hsv_metadata.predicted_class}` : ''}
                  </p>
                )}
                {result && result.used_for_dss === false && (
                  <p className="aiv-hint">Low confidence: saved, but not used for the fuzzy decision.</p>
                )}
                {!preview && <p className="aiv-hint">No image selected.</p>}
              </div>
            </div>

            <div className="data-table-container">
              <div className="table-header-section"><h2>Detection history</h2></div>
              <div className="table-wrapper">
                {history.length === 0 ? (
                  <div style={{ padding: '3rem 1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    <p style={{ margin: 0 }}>No detections yet.</p>
                  </div>
                ) : (
                  <table className="data-table">
                    <thead><tr><th>TIMESTAMP</th><th>NODE</th><th>LABEL</th><th>CONFIDENCE</th><th>MODEL</th></tr></thead>
                    <tbody>
                      {history.map((h) => (
                        <tr key={h.id}>
                          <td>{new Date(h.created_at).toLocaleString()}</td>
                          <td className="fw-500">{h.node_id}</td>
                          <td><span className={`dss-status-badge ${badgeClass(h.label)}`}>{h.label}</span></td>
                          <td>{(Number(h.confidence) * 100).toFixed(1)}%</td>
                          <td>{h.model_version}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

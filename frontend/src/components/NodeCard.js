'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useSocket } from '@/context/SocketContext';

function formatRelative(timeIso) {
  if (!timeIso) return '—';
  const diff = (Date.now() - new Date(timeIso).getTime()) / 1000;
  if (diff < 0) return '—';
  if (diff < 60) return `${Math.floor(diff)} dtk lalu`;
  if (diff < 3600) return `${Math.floor(diff / 60)} mnt lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  return new Date(timeIso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function dssClass(rec) {
  if (!rec) return '';
  const r = String(rec).toLowerCase();
  if (r === 'aman') return 'status-aman';
  if (r === 'waspada') return 'status-waspada';
  if (r === 'bahaya') return 'status-bahaya';
  return '';
}

function cycleBadgeClass(status) {
  if (!status) return '';
  const s = String(status).toUpperCase();
  if (s === 'FILL') return 'cycle-fill';
  if (s === 'SETTLE') return 'cycle-settle';
  if (s === 'MEASURE') return 'cycle-measure';
  if (s === 'DRAIN') return 'cycle-drain';
  if (s === 'IDLE') return 'cycle-idle';
  return '';
}

function metricBox(label, value, unit = '', className = '') {
  if (value === null || value === undefined) return null;
  return (
    <div className={`metric-box ${className}`}>
      <span className="metric-label">{label}</span>
      <span className="metric-value">
        {typeof value === 'number' ? value.toFixed(value % 1 === 0 ? 0 : 1) : value}
        {unit && <span className="metric-unit">{unit}</span>}
      </span>
    </div>
  );
}

export default function NodeCard({ device, initialReading }) {
  const { subscribe } = useSocket();
  const [reading, setReading] = useState(initialReading);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!device) return;
    const nodeId = device.node_id || device.id;
    const unsub = subscribe('sensor_update', (p) => {
      if (!p || (p.node_id !== nodeId && p.device_id !== device.id)) return;
      setReading(p);
    });
    return unsub;
  }, [device, subscribe]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(id);
  }, []);

  const d = device;
  const r = reading;
  const stale = !!r?.recorded_at && (now - new Date(r.recorded_at).getTime()) / 1000 > 60;

  if (!r) {
    return (
      <Link href={`/sensors/${d.id || d.node_id}`} className="node-card no-data">
        <div className="node-header">
          <div>
            <h3>{d.name || d.node_id || 'Unknown Node'}</h3>
            <span className="node-meta">{d.node_id} • {d.location || d.lokasi || '—'}</span>
          </div>
          <span className="status-dot offline" aria-label="No data" />
        </div>
        <p className="no-data-text">Belum ada data sensor</p>
      </Link>
    );
  }

  const isFinal = r.is_final === true || r.is_final === 1;
  const score = r.dss_score ?? null;
  const rec = r.dss_recommendation ?? null;

  return (
    <Link href={`/sensors/${d.id || d.node_id}`} className={`node-card ${stale ? 'stale' : ''}`} aria-label={`Detail ${d.name || d.node_id}`}>
      <div className="node-header">
        <div>
          <h3>{d.name || d.node_id || 'Unknown Node'}</h3>
          <span className="node-meta">
            {d.node_id} • {d.location || d.lokasi || '—'}
            {r.recorded_at && <span className="last-seen">Terakhir: {formatRelative(r.recorded_at)}{stale ? ' • data basi' : ''}</span>}
          </span>
        </div>
        <span className={`status-dot ${stale ? 'stale' : (d.status === 'offline' ? 'offline' : 'online')}`} aria-label={stale ? 'Data basi (>60 dtk)' : (d.status === 'offline' ? 'Offline' : 'Online')} />
      </div>

      <div className="metrics-main">
        {metricBox('Suhu', r.suhu, '°C')}
        {metricBox('Salinitas', r.salinitas, 'ppt')}
        {r.ph_level !== null && r.ph_level !== undefined && metricBox('pH', r.ph_level, '')}
        {r.turbidity !== null && r.turbidity !== undefined && metricBox('Kekeruhan', r.turbidity, 'NTU')}
      </div>

      <div className="metrics-secondary">
        {metricBox('Siklus', r.siklus_status, '')}
        {metricBox('Baterai', r.baterai, '%')}
        {metricBox('RSSI', r.rssi, 'dBm')}
        {metricBox('Seq', r.seq, '')}
      </div>

      {(score !== null || rec) && (
        <div className="dss-inline">
          {score !== null && <span className="dss-score">Skor: {Number(score).toFixed(1)}</span>}
          {rec && <span className={`dss-badge ${dssClass(rec)}`}>{rec.toUpperCase()}</span>}
        </div>
      )}
    </Link>
  );
}
'use client';

import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';

const POLL_INTERVAL_MS = 10000; // 10 detik

const LEVEL_COLORS = {
  bahaya: '#dc2626',
  waspada: '#f59e0b',
  normal: '#22c55e',
};

export default function TopAppBar() {
  const { user, logout, token, API_URL } = useAuth();

  // --- Profile state ---
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const profileRef = useRef(null);

  // --- Alerts state ---
  const [isAlertsOpen, setIsAlertsOpen] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [hasNew, setHasNew] = useState(false);
  const alertsRef = useRef(null);

  // Tutup dropdown saat klik di luar
  useEffect(() => {
    function handleClickOutside(e) {
      if (profileRef.current && !profileRef.current.contains(e.target)) {
        setIsProfileOpen(false);
      }
      if (alertsRef.current && !alertsRef.current.contains(e.target)) {
        setIsAlertsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Polling alert setiap 10 detik
  useEffect(() => {
    if (!token) return;

    async function fetchAlerts() {
      try {
        const res = await fetch(`${API_URL}/api/logs?limit=5`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        const newAlerts = data.logs || [];
        setAlerts(newAlerts);
        // Tampilkan badge merah jika ada alert bahaya atau waspada
        setHasNew(newAlerts.some(a => a.level_peringatan !== 'normal'));
      } catch (_) {}
    }

    fetchAlerts(); // Langsung fetch pertama kali
    const interval = setInterval(fetchAlerts, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [token, API_URL]);

  function handleSignOut() {
    logout();
    window.location.href = '/login';
  }

  function handleAlertsOpen() {
    setIsAlertsOpen(prev => !prev);
    setHasNew(false); // Bersihkan badge saat dibuka
  }

  function formatTime(dateStr) {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleTimeString('id-ID', {
      hour: '2-digit', minute: '2-digit',
    });
  }

  return (
    <header className="top-app-bar">
      <div className="header-title">
        <p>B-Monitor</p>
      </div>
      <div className="header-actions">

        {/* Alerts Dropdown */}
        <div className="profile-dropdown-wrapper" ref={alertsRef}>
          <button className="action-btn" aria-label="Alerts" onClick={handleAlertsOpen}>
            <div className="action-icon" style={{ position: 'relative' }}>
              <img src="/assets/7ed9ac62cbae16769d27d1e63b1feb45ae3e97ed.svg" alt="Alerts" />
              {hasNew && <span className="alert-badge" />}
            </div>
          </button>

          {isAlertsOpen && (
            <div className="profile-dropdown alerts-dropdown">
              <div className="alerts-dropdown-header">
                <p className="alerts-dropdown-title">Peringatan Terbaru</p>
              </div>
              <div className="profile-dropdown-divider" />
              {alerts.length === 0 ? (
                <p className="alerts-empty">Tidak ada peringatan.</p>
              ) : (
                alerts.map(alert => (
                  <div key={alert.id} className="alert-item">
                    <span
                      className="alert-item-dot"
                      style={{ background: LEVEL_COLORS[alert.level_peringatan] || '#94a3b8' }}
                    />
                    <div className="alert-item-body">
                      <p className="alert-item-msg">{alert.pesan_notifikasi}</p>
                      <p className="alert-item-meta">
                        {alert.device_name} · {formatTime(alert.created_at)}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* User Profile Dropdown */}
        <div className="profile-dropdown-wrapper" ref={profileRef}>
          <button
            className="action-btn"
            aria-label="User Profile"
            onClick={() => setIsProfileOpen(prev => !prev)}
          >
            <div className="action-icon">
              <img src="/assets/8f60a37f8bb6bc407fdd3dfb8a0649c83400b182.svg" alt="User" />
            </div>
          </button>

          {isProfileOpen && (
            <div className="profile-dropdown">
              <div className="profile-dropdown-header">
                <p className="profile-name">{user?.name || 'User'}</p>
                <p className="profile-role">{user?.role || 'viewer'}</p>
              </div>
              <div className="profile-dropdown-divider" />
              <button className="profile-dropdown-signout" onClick={handleSignOut}>
                Sign Out
              </button>
            </div>
          )}
        </div>

      </div>
    </header>
  );
}

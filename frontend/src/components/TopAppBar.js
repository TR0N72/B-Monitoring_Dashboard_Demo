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
  const { user, logout, API_URL } = useAuth();

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

  // Polling alert dengan Exponential Backoff
  useEffect(() => {
    if (!user) return;

    let timeoutId = null;
    let delay = 10000;        // mulai 10 detik
    const MAX_DELAY = 300000; // cap 5 menit
    let cancelled = false;

    async function fetchAlerts() {
      try {
        const res = await fetch(`${API_URL}/api/logs?limit=5`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error('non-2xx');
        const data = await res.json();
        const newAlerts = data.logs || [];
        setAlerts(newAlerts);
        setHasNew(newAlerts.some(a => a.level_peringatan !== 'normal'));
        delay = 10000; // reset ke normal jika berhasil
      } catch (_) {
        delay = Math.min(delay * 2, MAX_DELAY); // backoff eksponensial
      } finally {
        if (!cancelled) timeoutId = setTimeout(fetchAlerts, delay);
      }
    }

    fetchAlerts();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [user, API_URL]);


  async function handleSignOut() {
    await logout();
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
      <button
        className="action-btn nav-toggle"
        aria-label="Toggle navigation"
        onClick={() => document.body.classList.toggle('nav-open')}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
      </button>
      <div className="header-title">
        <p>B-Monitor</p>
      </div>
      <div className="header-actions">

        {/* Alerts Dropdown */}
        <div className="profile-dropdown-wrapper" ref={alertsRef}>
          <button className="action-btn" aria-label="Alerts" onClick={handleAlertsOpen}>
            <div className="action-icon" style={{ position: 'relative' }}>
              <img src="/icons/alerts.svg" alt="Alerts" />
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
              <img src="/icons/user.svg" alt="User" />
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


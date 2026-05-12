'use client';

import { useState, useEffect } from 'react';
import { useSocket } from '@/hooks/useSocket';

export default function AlertBanner() {
  const { lastAlert } = useSocket();
  const [alert, setAlert] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (lastAlert) {
      setAlert(lastAlert);
      setVisible(true);
    }
  }, [lastAlert]);

  const handleClose = () => {
    setVisible(false);
  };

  if (!visible || !alert) return null;

  const level = alert.level_peringatan || alert.level || 'critical';
  const message = alert.pesan_notifikasi || alert.message || 'System alert received.';

  return (
    <div className={`alert-banner ${level.toLowerCase()}`} id="alertBanner">
      <div className="alert-banner-content">
        <svg className="alert-banner-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
          <line x1="12" y1="9" x2="12" y2="13"></line>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
        <span>{message}</span>
      </div>
      <button className="alert-banner-close" onClick={handleClose} aria-label="Close alert">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  );
}
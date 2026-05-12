'use client';

import { useState, useEffect } from 'react';

export default function Toast({ message, type = 'success', show, onClose, duration = 3000 }) {
  useEffect(() => {
    if (show) {
      const timer = setTimeout(() => {
        onClose?.();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [show, duration, onClose]);

  const bgColor = type === 'success' ? '#22c55e' : type === 'error' ? '#dc2626' : '#3b82f6';
  const borderColor = type === 'success' ? '#16a34a' : type === 'error' ? '#b91c1c' : '#2563eb';

  return (
    <div
      className={`toast-notification ${show ? 'show' : ''}`}
      style={{ backgroundColor: bgColor, borderColor }}
    >
      {type === 'success' && (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
          <polyline points="22 4 12 14.01 9 11.01"></polyline>
        </svg>
      )}
      {type === 'error' && (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="15" y1="9" x2="9" y2="15"></line>
          <line x1="9" y1="9" x2="15" y2="15"></line>
        </svg>
      )}
      <span>{message}</span>
    </div>
  );
}
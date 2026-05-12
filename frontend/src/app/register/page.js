'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApi } from '@/hooks/useApi';
import '@/styles/auth.css';

export default function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [telegramId, setTelegramId] = useState('');
  const [sendInvite, setSendInvite] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [tooltipActive, setTooltipActive] = useState(false);
  const router = useRouter();
  const { apiFetch } = useApi();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const res = await apiFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password, role: 'operator' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');

      setSuccess('Worker registered successfully. Redirecting to login…');
      setTimeout(() => router.push('/login'), 1800);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card register-card visible" id="registerCard">
        <div className="register-header">
          <h1 className="register-title">Worker Registration</h1>
          <p className="register-subtitle">Add a new operational worker to the system and configure alert routing.</p>
        </div>
        <form className="auth-form" id="registerForm" onSubmit={handleSubmit}>
          <div className="form-section">
            <p className="section-label">WORKER DETAILS</p>
            <div className="form-group">
              <label className="form-label" htmlFor="workerName">Full Name</label>
              <input type="text" id="workerName" className="form-input" placeholder="e.g. Jane Doe" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="workerEmail">Email Address</label>
              <input type="email" id="workerEmail" className="form-input" placeholder="jane.doe@example.com" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="workerPassword">Temporary Password</label>
              <div className="input-password-wrapper">
                <input type={showPassword ? 'text' : 'password'} id="workerPassword" className="form-input" placeholder="••••••••" required minLength="8" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" className="password-toggle" onClick={() => setShowPassword(!showPassword)}>
                  <svg className="eye-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {!showPassword ? (
                      <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></>
                    ) : (
                      <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></>
                    )}
                  </svg>
                </button>
              </div>
              <p className="form-hint">User will be prompted to change this upon first login.</p>
            </div>
          </div>
          <div className="form-section">
            <p className="section-label">ALERT ROUTING</p>
            <div className="form-group">
              <div className="form-label-row">
                <label className="form-label" htmlFor="telegramId">Telegram ID</label>
                <button type="button" className={`info-tooltip ${tooltipActive ? 'active' : ''}`} onClick={() => setTooltipActive(!tooltipActive)} aria-label="Info about Telegram ID">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                  </svg>
                  <span className="tooltip-text">Enter the worker&apos;s Telegram username so they receive real-time critical alerts and shift change notifications via the B-Monitor Telegram Bot.</span>
                </button>
              </div>
              <input type="text" id="telegramId" className="form-input" placeholder="@ username" autoComplete="off" value={telegramId} onChange={(e) => setTelegramId(e.target.value)} />
              <p className="form-hint">Required for critical system alerts and shift notifications.</p>
            </div>
            <div className="form-checkbox-group">
              <label className="checkbox-label-row" htmlFor="sendInvite">
                <input type="checkbox" id="sendInvite" checked={sendInvite} onChange={(e) => setSendInvite(e.target.checked)} />
                <span className="custom-checkbox" aria-hidden="true">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </span>
                <span className="checkbox-text">Send invitation email with setup instructions</span>
              </label>
            </div>
          </div>
          {error && (
            <div className="form-error" style={{ display: 'flex' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="15" y1="9" x2="9" y2="15"></line>
                <line x1="9" y1="9" x2="15" y2="15"></line>
              </svg>
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="form-success" style={{ display: 'flex' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
              </svg>
              <span>{success}</span>
            </div>
          )}
          <div className="form-actions">
            <a href="/login" className="auth-btn secondary" id="cancelBtn">Cancel</a>
            <button type="submit" className={`auth-btn primary ${loading ? 'loading' : ''}`} id="registerBtn" disabled={loading}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="8.5" cy="7" r="4"></circle>
                <line x1="20" y1="8" x2="20" y2="14"></line>
                <line x1="23" y1="11" x2="17" y2="11"></line>
              </svg>
              <span>Register Worker</span>
            </button>
          </div>
        </form>
      </div>
      <p className="auth-footer">&copy; 2026 B-Monitor &middot; LoRa-BandengMon</p>
    </div>
  );
}
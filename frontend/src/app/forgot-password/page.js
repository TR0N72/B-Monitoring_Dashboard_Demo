'use client';

import { useState } from 'react';
import Link from 'next/link';
import Logo from '@/components/Logo';
import '@/styles/auth.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function post(path, body) {
  const res = await fetch(`${API_URL}/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Permintaan gagal.');
  return data;
}

export default function ForgotPasswordPage() {
  const [step, setStep] = useState('request'); // request -> reset -> done
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (step === 'request') {
        setInfo((await post('forgot', { username })).message);
        setStep('reset');
      } else {
        setInfo((await post('reset', { username, code, password })).message);
        setStep('done');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card visible">
        <div className="auth-brand">
          <div className="auth-logo"><Logo size={24} /></div>
          <h1 className="auth-title">Reset Password</h1>
          <p className="auth-subtitle">Kode dikirim ke Telegram yang terdaftar</p>
        </div>
        {step === 'done' ? (
          <p role="status">{info}</p>
        ) : (
          <form className="auth-form" onSubmit={submit}>
            <div className="form-group">
              <label className="form-label" htmlFor="fpUsername">Username</label>
              <input id="fpUsername" className="form-input" required autoComplete="username" readOnly={step === 'reset'} value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            {step === 'reset' && (
              <>
                <p role="status" style={{ fontSize: '0.85rem' }}>{info}</p>
                <div className="form-group">
                  <label className="form-label" htmlFor="fpCode">Kode 6 digit</label>
                  <input id="fpCode" className="form-input" required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="fpPassword">Password baru</label>
                  <input id="fpPassword" type="password" className="form-input" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
              </>
            )}
            {error && <div className="form-error" role="alert" style={{ display: 'flex' }}><span>{error}</span></div>}
            <button type="submit" className={`auth-btn primary ${loading ? 'loading' : ''}`} disabled={loading}>
              <span>{step === 'request' ? 'Kirim kode' : 'Ubah password'}</span>
            </button>
          </form>
        )}
        <div className="auth-divider"></div>
        <p style={{ fontSize: '0.85rem' }}><Link href="/login" className="form-link">Kembali ke login</Link></p>
      </div>
    </div>
  );
}

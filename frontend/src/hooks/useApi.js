'use client';

import { useAuth } from '@/context/AuthContext';
import { useCallback } from 'react';

export function useApi() {
  const { token, logout, API_URL } = useAuth();

  const apiFetch = useCallback(async (endpoint, options = {}) => {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (res.status === 401) {
      logout();
      throw new Error('Session expired. Please login again.');
    }

    return res;
  }, [token, logout, API_URL]);

  return { apiFetch };
}
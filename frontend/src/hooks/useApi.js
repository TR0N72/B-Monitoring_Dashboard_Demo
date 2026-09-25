'use client';

import { useAuth } from '@/context/AuthContext';
import { useCallback } from 'react';

export function useApi() {
  const { logout, API_URL } = useAuth();

  const apiFetch = useCallback(async (endpoint, options = {}) => {
    const res = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      credentials: 'include', // Send HttpOnly cookie automatically
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (res.status === 401) {
      logout();
      throw new Error('Session expired. Please login again.');
    }

    return res;
  }, [logout, API_URL]);

  return { apiFetch };
}
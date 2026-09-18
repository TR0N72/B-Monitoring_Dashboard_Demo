'use client';

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '@/context/AuthContext';

const SocketContext = createContext(null);

/**
 * SocketProvider — mengelola SATU koneksi WebSocket untuk seluruh aplikasi.
 * Semua komponen yang memanggil useSocket() berbagi koneksi yang sama.
 * Ini mencegah terciptanya multiple koneksi yang menyebabkan runtime.lastError flooding.
 */
export function SocketProvider({ children }) {
  const { isAuthenticated, API_URL } = useAuth();
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [lastAlert, setLastAlert] = useState(null);

  // Simpan semua subscriber agar bisa di-reattach setelah reconnect
  const listenersRef = useRef(new Map());

  useEffect(() => {
    // Jangan buat koneksi jika belum login
    if (!isAuthenticated) {
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
        setConnected(false);
      }
      return;
    }

    // Hindari duplikasi koneksi jika sudah ada yang aktif
    if (socketRef.current?.connected) return;

    const socketUrl = API_URL || 'http://localhost:3001';

    const socket = io(socketUrl, {
      path: '/ws',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[WS] Connected:', socket.id);
      setConnected(true);
      socket.emit('request_status');

      // Re-attach semua subscriber aktif setelah reconnect
      listenersRef.current.forEach((handler, event) => {
        socket.off(event, handler);
        socket.on(event, handler);
      });
    });

    socket.on('disconnect', (reason) => {
      console.log('[WS] Disconnected:', reason);
      setConnected(false);
    });

    socket.on('connect_error', (err) => {
      console.warn('[WS] Connection error:', err.message);
      setConnected(false);
    });

    socket.on('new_alert', (data) => {
      setLastAlert(data);
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [isAuthenticated, API_URL]);

  /**
   * Subscribe ke event tertentu. Mengembalikan fungsi unsubscribe.
   */
  const subscribe = useCallback((event, handler) => {
    listenersRef.current.set(event, handler);

    if (socketRef.current) {
      socketRef.current.off(event, handler);
      socketRef.current.on(event, handler);
    }

    return () => {
      listenersRef.current.delete(event);
      if (socketRef.current) {
        socketRef.current.off(event, handler);
      }
    };
  }, []);

  /**
   * Emit event ke server via socket yang aktif.
   */
  const emit = useCallback((event, data) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit(event, data);
    }
  }, []);

  const value = {
    socket: socketRef.current,
    connected,
    lastAlert,
    subscribe,
    emit,
  };

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
}

export default SocketContext;

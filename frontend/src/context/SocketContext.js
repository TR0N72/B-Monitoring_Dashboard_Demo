'use client';

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '@/context/AuthContext';

const SocketContext = createContext(null);

// Single shared WebSocket connection for the app to prevent duplicate connections and runtime.lastError flooding.
export function SocketProvider({ children }) {
  const { isAuthenticated, API_URL } = useAuth();
  const socketRef = useRef(null);
  const [socketInstance, setSocketInstance] = useState(null);
  const [connected, setConnected] = useState(false);
  const [lastAlert, setLastAlert] = useState(null);

  const listenersRef = useRef(new Map());

  useEffect(() => {
    if (!isAuthenticated) {
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
        setSocketInstance(null);
        setConnected(false);
      }
      return;
    }

    if (socketRef.current?.connected) return;

    const socketUrl = API_URL || undefined; // empty = same-origin via nginx

    const socket = io(socketUrl, {
      path: '/ws',
      transports: ['websocket', 'polling'],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
    });

    socketRef.current = socket;
    setSocketInstance(socket);

    socket.on('connect', () => {
      console.log('[WS] Connected:', socket.id);
      setConnected(true);
      socket.emit('request_status');

      // Re-attach active subscribers after reconnect.
      listenersRef.current.forEach((handlers, event) => {
        handlers.forEach((handler) => {
          socket.off(event, handler);
          socket.on(event, handler);
        });
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

    socket.on('system:emergency', (data) => {
      setLastAlert({
        level_peringatan: 'critical',
        pesan_notifikasi: `🚨 [EMERGENCY] ${data.message || 'Kegagalan hardware terdeteksi!'}`,
      });
    });

    socket.on('system:status', (data) => {
      setLastAlert({
        level_peringatan: data.level === 'bahaya' ? 'critical' : 'warning',
        pesan_notifikasi: `⚠️ [${(data.level || 'STATUS').toUpperCase()}] ${data.message || 'Perubahan status sistem.'}`,
      });
    });

    socket.on('sensor:vibration', (data) => {
      if (data.vibrating) {
        setLastAlert({
          level_peringatan: 'warning',
          pesan_notifikasi: `📳 Getaran aktif terdeteksi pada node ${data.node_id || data.device_id}.`,
        });
      }
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      setSocketInstance(null);
      setConnected(false);
    };
  }, [isAuthenticated, API_URL]);

  // Returns an unsubscribe function that removes only this handler without affecting other subscribers.
  const subscribe = useCallback((event, handler) => {
    const map = listenersRef.current;

    if (!map.has(event)) {
      map.set(event, new Set());
    }
    map.get(event).add(handler);

    if (socketRef.current) {
      socketRef.current.on(event, handler);
    }

    return () => {
      const handlers = map.get(event);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          map.delete(event);
        }
      }
      if (socketRef.current) {
        socketRef.current.off(event, handler);
      }
    };
  }, []);

  const emit = useCallback((event, data) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit(event, data);
    }
  }, []);

  const value = {
    socket: socketInstance,
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

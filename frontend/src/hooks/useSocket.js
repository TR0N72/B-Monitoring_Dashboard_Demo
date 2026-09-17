'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '@/context/AuthContext';

const SOCKET_PATH = '/ws';

export function useSocket() {
  const { isAuthenticated, API_URL } = useAuth();
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [lastAlert, setLastAlert] = useState(null);
  const listenersRef = useRef(new Map());

  useEffect(() => {
    if (!isAuthenticated) return;

    const socketUrl = API_URL || 'http://localhost:3001';

    const socket = io(socketUrl, {
      path: SOCKET_PATH,
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

    listenersRef.current.forEach((handler, event) => {
      socket.on(event, handler);
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [isAuthenticated, API_URL]);

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

  const emit = useCallback((event, data) => {
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit(event, data);
    }
  }, []);

  const onAlert = useCallback((callback) => {
    return subscribe('new_alert', callback);
  }, [subscribe]);

  return { socket: socketRef.current, connected, lastAlert, onAlert, subscribe, emit };
}
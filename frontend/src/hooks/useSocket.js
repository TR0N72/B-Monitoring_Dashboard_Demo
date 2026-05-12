'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export function useSocket() {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [lastAlert, setLastAlert] = useState(null);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionAttempts: Infinity,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      console.log('[Socket.io] Connected');
    });

    socket.on('disconnect', () => {
      setConnected(false);
      console.log('[Socket.io] Disconnected');
    });

    socket.on('alert:new', (data) => {
      setLastAlert(data);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const onAlert = useCallback((callback) => {
    if (socketRef.current) {
      socketRef.current.on('alert:new', callback);
      return () => socketRef.current?.off('alert:new', callback);
    }
  }, []);

  return { socket: socketRef.current, connected, lastAlert, onAlert };
}
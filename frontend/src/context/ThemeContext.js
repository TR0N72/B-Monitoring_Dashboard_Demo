'use client';

import { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Load dari localStorage saat pertama kali
  useEffect(() => {
    const saved = localStorage.getItem('bmonitor_theme');
    if (saved === 'dark') setIsDarkMode(true);
  }, []);

  // Apply class ke document.body setiap kali berubah
  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.add('dark-theme');
      localStorage.setItem('bmonitor_theme', 'dark');
    } else {
      document.body.classList.remove('dark-theme');
      localStorage.setItem('bmonitor_theme', 'light');
    }
  }, [isDarkMode]);

  const toggleDarkMode = () => setIsDarkMode(prev => !prev);

  return (
    <ThemeContext.Provider value={{ isDarkMode, toggleDarkMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

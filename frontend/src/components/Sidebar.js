'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

const baseNavItems = [
  { href: '/', label: 'Dashboard', icon: '/assets/17d6b01bbfda0584d2308aa4f506bfe509938f0f.svg' },
  { href: '/sensors', label: 'Sensor Nodes', icon: '/assets/af67b97eb2179670ffc08ddbb7d9cf1c70b126d9.svg' },
  { href: '/analytics', label: 'Analytics', icon: '/assets/a3cf9e83a6d2c6bae4c1e1b26c4f0b60ca53a101.svg' },
  { href: '/dss', label: 'DSS Engine', iconSvg: 'brain' },
  { href: '/actuator', label: 'Actuator', iconSvg: 'zap' },

  { href: '/export', label: 'Export Logs', icon: '/assets/9d40389f2a1880afd833b2f14daebc6e3ce6bbf0.svg' },
  { href: '/config', label: 'System Config', icon: '/assets/f2c53fa4859da524365e8bda2fd717f3946f2e8a.svg' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { logout, user } = useAuth();

  const navItems = [...baseNavItems];
  if (user?.role === 'admin') {
    navItems.push({ href: '/users', label: 'User Management', iconSvg: 'users' });
  }

  const isActive = (href) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  const handleSignOut = (e) => {
    e.preventDefault();
    logout();
    window.location.href = '/login';
  };

  const renderNavIcon = (item) => {
    if (item.icon) {
      return <img src={item.icon} alt={item.label} />;
    }
    switch (item.iconSvg) {
      case 'brain':
        return (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9.5 2A5.5 5.5 0 0 0 4 7.5c0 1.58.7 3 1.8 3.98A5.5 5.5 0 0 0 4 15.5 5.5 5.5 0 0 0 9.5 21h0a5 5 0 0 0 2.5-.67A5 5 0 0 0 14.5 21h0A5.5 5.5 0 0 0 20 15.5a5.5 5.5 0 0 0-1.8-4.02A5.5 5.5 0 0 0 20 7.5 5.5 5.5 0 0 0 14.5 2h0a5 5 0 0 0-2.5.67A5 5 0 0 0 9.5 2z"/>
            <path d="M12 2v19"/>
          </svg>
        );
      case 'zap':
        return (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
        );
      case 'eye':
        return (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        );
      case 'users':
        return (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
            <circle cx="9" cy="7" r="4"></circle>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
          </svg>
        );
      default:
        return null;
    }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <div className="brand-logo">
            <p>SA</p>
          </div>
          <div className="brand-text">
            <div className="brand-title">
              <p>B-Monitor</p>
            </div>
            <div className="brand-subtitle">
              <p>{user ? `Session: ${user.name}` : 'Active Session: Unit 04'}</p>
            </div>
          </div>
        </div>
      </div>
      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-item ${isActive(item.href) ? 'active' : ''}`}
          >
            <div className="nav-icon">
              {renderNavIcon(item)}
            </div>
            <p>{item.label}</p>
          </Link>
        ))}
      </nav>
      <div className="sidebar-footer">
        {/* Fitur belum diimplementasi
        <a href="#" className="nav-item">
          <div className="nav-icon">
            <img src="/assets/c2f399cbc92673b4678734c1efe5796b00a9f725.svg" alt="Support" />
          </div>
          <p>Support</p>
        </a>
        */}
        <a href="#" className="nav-item" onClick={handleSignOut}>
          <div className="nav-icon">
            <img src="/assets/c64a15be25be00edb87b8a12e60383d8ea3306ce.svg" alt="Sign Out" />
          </div>
          <p>Sign Out</p>
        </a>
      </div>
    </aside>
  );
}
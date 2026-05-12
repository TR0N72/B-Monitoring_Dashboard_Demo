'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

const navItems = [
  { href: '/', label: 'Dashboard', icon: '/assets/17d6b01bbfda0584d2308aa4f506bfe509938f0f.svg' },
  { href: '/sensors', label: 'Sensor Nodes', icon: '/assets/af67b97eb2179670ffc08ddbb7d9cf1c70b126d9.svg' },
  { href: '/analytics', label: 'Analytics', icon: '/assets/a3cf9e83a6d2c6bae4c1e1b26c4f0b60ca53a101.svg' },
  { href: '/export', label: 'Export Logs', icon: '/assets/9d40389f2a1880afd833b2f14daebc6e3ce6bbf0.svg' },
  { href: '/config', label: 'System Config', icon: '/assets/f2c53fa4859da524365e8bda2fd717f3946f2e8a.svg' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { logout, user } = useAuth();

  const isActive = (href) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  const handleSignOut = (e) => {
    e.preventDefault();
    logout();
    window.location.href = '/login';
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
              <img src={item.icon} alt={item.label} />
            </div>
            <p>{item.label}</p>
          </Link>
        ))}
      </nav>
      <div className="sidebar-footer">
        <a href="#" className="nav-item">
          <div className="nav-icon">
            <img src="/assets/c2f399cbc92673b4678734c1efe5796b00a9f725.svg" alt="Support" />
          </div>
          <p>Support</p>
        </a>
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
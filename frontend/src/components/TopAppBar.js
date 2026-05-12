'use client';

export default function TopAppBar() {
  return (
    <header className="top-app-bar">
      <div className="header-title">
        <p>B-Monitor</p>
      </div>
      <div className="header-actions">
        <button className="action-btn" aria-label="Notifications">
          <div className="action-icon">
            <img src="/assets/ffa5e2bc3de37b0468bfca4dfb3cb27676bb36f1.svg" alt="Notifications" />
          </div>
        </button>
        <button className="action-btn" aria-label="Alerts">
          <div className="action-icon">
            <img src="/assets/7ed9ac62cbae16769d27d1e63b1feb45ae3e97ed.svg" alt="Alerts" />
          </div>
        </button>
        <button className="action-btn" aria-label="User Profile">
          <div className="action-icon">
            <img src="/assets/8f60a37f8bb6bc407fdd3dfb8a0649c83400b182.svg" alt="User" />
          </div>
        </button>
      </div>
    </header>
  );
}
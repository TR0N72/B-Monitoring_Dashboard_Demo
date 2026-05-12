'use client';

export default function MetricCard({ label, value, unit, icon, isDanger, fillWidth, fillColor }) {
  return (
    <div className={`metric-card ${isDanger ? 'danger-state' : ''}`}>
      <div className="card-header">
        <p>{label}</p>
        <div className={`card-icon ${!icon ? '' : ''}`}>
          {isDanger ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="danger-icon">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
          ) : icon ? (
            <img src={icon} alt={label} />
          ) : null}
        </div>
      </div>
      <div className="card-value">
        <p className="value">{value}</p>
        {unit && <p className="unit">{unit}</p>}
      </div>
      <div className="card-progress">
        <div className="progress-track">
          <div
            className="progress-fill"
            style={{
              width: fillWidth || '50%',
              backgroundColor: isDanger ? '#dc2626' : (fillColor || 'var(--progress-fill-blue)'),
            }}
          ></div>
        </div>
      </div>
    </div>
  );
}
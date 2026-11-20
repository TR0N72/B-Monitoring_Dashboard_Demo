// Droplet with a water line: water-quality mark. Colour follows currentColor.
export default function Logo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="B-Monitor">
      <path d="M12 3C9 7 5.5 11 5.5 15a6.5 6.5 0 0 0 13 0c0-4-3.5-8-6.5-12z" />
      <path d="M8.5 15c1.2-1.2 2.3-1.2 3.5 0s2.3 1.2 3.5 0" />
    </svg>
  );
}

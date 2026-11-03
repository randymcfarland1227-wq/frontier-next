"use client";

/**
 * Night mode scenery (CSS shows it only in dark mode): a star field, planets, moons, two
 * constellations and shooting stars sit behind the page; a small astronaut drifts over a corner.
 * Everything is decorative (aria-hidden, no pointer events) and moves only with transform/opacity.
 */

const delays = [0, 1.4, 0.7, 2.1, 0.3, 1.8, 1.1];

function Constellation({
  className,
  label,
  stars,
  lines,
  box,
}: {
  className: string;
  label: string;
  stars: Array<[number, number, number]>;
  lines: string;
  box: string;
}) {
  return (
    <svg className={`sk-const ${className}`} viewBox={box} fill="none">
      <path d={lines} />
      {stars.map(([x, y, r], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={r}
          style={{ animationDelay: `${delays[i % delays.length]}s` }}
        />
      ))}
      <text x="50%" y="97%" textAnchor="middle">
        {label}
      </text>
    </svg>
  );
}

export function NightSky() {
  return (
    <>
      <div className="sk-night" aria-hidden="true">
        {/* A ringed planet, half off the left edge */}
        <svg className="sk-planet sk-p-ring" viewBox="0 0 240 160">
          <defs>
            <radialGradient id="nsPlanet" cx="34%" cy="30%" r="78%">
              <stop offset="0" stopColor="#e2c8ff" />
              <stop offset=".5" stopColor="#8a62e0" />
              <stop offset="1" stopColor="#26175a" />
            </radialGradient>
            <linearGradient id="nsRing" x1="0" x2="1">
              <stop offset="0" stopColor="#f1e4ff" stopOpacity=".05" />
              <stop offset=".5" stopColor="#f1e4ff" stopOpacity=".75" />
              <stop offset="1" stopColor="#f1e4ff" stopOpacity=".1" />
            </linearGradient>
            <clipPath id="nsDisc">
              <circle cx="120" cy="80" r="50" />
            </clipPath>
          </defs>
          <g transform="rotate(-18 120 80)">
            <ellipse cx="120" cy="80" rx="108" ry="22" stroke="url(#nsRing)" strokeWidth="8" />
            <circle cx="120" cy="80" r="50" fill="url(#nsPlanet)" />
            <g clipPath="url(#nsDisc)" stroke="#ffffff" strokeOpacity=".12" strokeWidth="5" fill="none">
              <path d="M60 66 Q120 58 180 70" />
              <path d="M62 90 Q120 82 182 94" />
            </g>
            <path d="M12 80 A108 22 0 0 0 228 80" stroke="url(#nsRing)" strokeWidth="8" />
          </g>
        </svg>

        {/* A small teal planet with a moon that slowly circles it */}
        <svg className="sk-planet sk-p-teal" viewBox="0 0 120 120">
          <defs>
            <radialGradient id="nsTeal" cx="35%" cy="30%" r="75%">
              <stop offset="0" stopColor="#b8f5e8" />
              <stop offset=".6" stopColor="#2fa6a0" />
              <stop offset="1" stopColor="#0d3b52" />
            </radialGradient>
          </defs>
          <ellipse cx="60" cy="60" rx="46" ry="46" stroke="#cfe6ff" strokeOpacity=".18" strokeDasharray="2 5" />
          <circle cx="60" cy="60" r="22" fill="url(#nsTeal)" />
          <g>
            <circle cx="60" cy="14" r="5" fill="#dde2ee" />
            <circle cx="58.5" cy="12.5" r="1.3" fill="#b8bfd2" />
            <animateTransform attributeName="transform" type="rotate" from="0 60 60" to="360 60 60" dur="48s" repeatCount="indefinite" />
          </g>
        </svg>

        {/* A crescent moon */}
        <svg className="sk-moon" viewBox="0 0 100 100">
          <defs>
            <mask id="nsBite">
              <rect width="100" height="100" fill="#fff" />
              <circle cx="64" cy="42" r="34" fill="#000" />
            </mask>
          </defs>
          <g mask="url(#nsBite)">
            <circle cx="46" cy="52" r="36" fill="#f4efe0" />
            <circle cx="30" cy="62" r="5" fill="#d9d2bd" />
            <circle cx="40" cy="40" r="3" fill="#d9d2bd" />
            <circle cx="26" cy="46" r="2.2" fill="#d9d2bd" />
          </g>
        </svg>

        <Constellation
          className="sk-c-cass"
          label="CASSIOPEIA"
          box="0 0 220 120"
          lines="M12 30 L58 92 L102 44 L152 96 L206 36"
          stars={[[12, 30, 2.6], [58, 92, 3], [102, 44, 2.4], [152, 96, 3.2], [206, 36, 2.6]]}
        />
        <Constellation
          className="sk-c-dipper"
          label="URSA MAJOR"
          box="0 0 260 140"
          lines="M20 36 L66 54 L106 62 L146 70 L212 74 L206 112 L150 106 L146 70"
          stars={[[20, 36, 2.4], [66, 54, 2.4], [106, 62, 2.8], [146, 70, 2.6], [212, 74, 3], [206, 112, 2.6], [150, 106, 2.4]]}
        />

        <i /><i /><i /><i /><i /><i /><i />
      </div>

      {/* The astronaut: floats over a corner, slowly turning. */}
      <div className="sk-astro" aria-hidden="true">
        <svg viewBox="0 0 120 150">
          <defs>
            <linearGradient id="nsVisor" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#3a3f8f" />
              <stop offset="1" stopColor="#12113a" />
            </linearGradient>
          </defs>
          <path className="sk-astro-tether" d="M46 96 C20 112 40 132 6 146" />
          <rect x="30" y="52" width="22" height="48" rx="8" fill="#b9c2da" />
          <g className="sk-astro-arm">
            <rect x="74" y="60" width="12" height="32" rx="6" fill="#eef1f8" transform="rotate(-38 80 62)" />
            <circle cx="95" cy="46" r="6" fill="#cfd6e8" />
          </g>
          <rect x="38" y="56" width="42" height="46" rx="14" fill="#f4f6fb" />
          <rect x="48" y="68" width="22" height="13" rx="3" fill="#8a96d4" />
          <circle cx="53" cy="90" r="2.4" fill="#ff7a7a" />
          <circle cx="61" cy="90" r="2.4" fill="#5fd6c8" />
          <rect x="22" y="64" width="14" height="30" rx="7" fill="#eef1f8" transform="rotate(14 29 66)" />
          <circle cx="22" cy="96" r="6" fill="#cfd6e8" />
          <rect x="42" y="98" width="14" height="30" rx="7" fill="#eef1f8" transform="rotate(8 49 100)" />
          <rect x="62" y="98" width="14" height="30" rx="7" fill="#eef1f8" transform="rotate(-10 69 100)" />
          <rect x="40" y="120" width="18" height="11" rx="5" fill="#8a96d4" transform="rotate(8 49 125)" />
          <rect x="62" y="120" width="18" height="11" rx="5" fill="#8a96d4" transform="rotate(-10 71 125)" />
          <circle cx="60" cy="38" r="27" fill="#f4f6fb" stroke="#cfd6e8" strokeWidth="2" />
          <ellipse cx="60" cy="38" rx="19" ry="16" fill="url(#nsVisor)" />
          <path d="M48 31 Q56 25 66 28" stroke="#ffffff" strokeOpacity=".55" strokeWidth="2.4" strokeLinecap="round" fill="none" />
          <circle cx="68" cy="45" r="1.6" fill="#ffffff" fillOpacity=".7" />
        </svg>
      </div>
    </>
  );
}

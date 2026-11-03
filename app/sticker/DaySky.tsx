"use client";

/**
 * Day mode scenery (CSS shows it only outside dark mode): a park behind the page — sun, drifting
 * clouds, rolling hills with a path, pines and oaks that sway, a bench and lamp, falling leaves,
 * birds and a butterfly. Decorative only (aria-hidden, no pointer events); animates transform/opacity.
 */

function Pine({ x, h, tone, delay }: { x: number; h: number; tone: string; delay: number }) {
  const w = h * 0.5;
  return (
    <g transform={`translate(${x} ${300 - h})`}>
      <g className="sk-tree" style={{ animationDelay: `${delay}s` }}>
      <rect x={w / 2 - 4} y={h - 18} width="8" height="18" fill="#6b4a2f" />
      <path d={`M${w / 2} 0 L${w} ${h * 0.5} H0 Z`} fill={tone} />
      <path d={`M${w / 2} ${h * 0.22} L${w * 1.05} ${h * 0.78} H${-w * 0.05} Z`} fill={tone} opacity=".92" />
      </g>
    </g>
  );
}

function Oak({ x, r, tone, delay }: { x: number; r: number; tone: string; delay: number }) {
  return (
    <g transform={`translate(${x} ${300 - r * 2.3})`}>
      <g className="sk-tree" style={{ animationDelay: `${delay}s` }}>
      <rect x={r - 5} y={r * 1.3} width="10" height={r * 1.0} rx="3" fill="#6b4a2f" />
      <circle cx={r} cy={r} r={r} fill={tone} />
      <circle cx={r * 0.55} cy={r * 1.2} r={r * 0.62} fill={tone} opacity=".9" />
      <circle cx={r * 1.5} cy={r * 1.15} r={r * 0.6} fill={tone} opacity=".9" />
      <circle cx={r * 0.8} cy={r * 0.55} r={r * 0.4} fill="#ffffff" opacity=".12" />
      </g>
    </g>
  );
}

const Cloud = ({ className }: { className: string }) => (
  <svg className={`sk-cloud ${className}`} viewBox="0 0 200 70">
    <path d="M20 58 C4 58 2 36 22 34 C22 14 52 8 62 24 C72 8 106 10 110 30 C128 20 152 30 148 46 C168 44 182 56 170 62 C150 62 40 62 20 58 Z" />
  </svg>
);

export function DaySky() {
  return (
    <div className="sk-dayscene" aria-hidden="true">
      <div className="sk-daysun" />
      <i className="sk-shaft" />
      <i className="sk-shaft is-2" />
      <Cloud className="c1" />
      <Cloud className="c2" />
      <Cloud className="c3" />

      <svg className="sk-hills" viewBox="0 0 1440 320" preserveAspectRatio="none">
        <path d="M0 140 C180 70 340 110 520 90 C720 66 900 130 1100 96 C1260 70 1360 100 1440 84 V320 H0 Z" fill="#b9dca0" opacity=".85" />
        <path d="M0 190 C220 130 420 200 640 160 C860 118 1060 190 1240 150 C1330 132 1400 150 1440 140 V320 H0 Z" fill="#92c981" />
        <path d="M0 250 C240 200 460 270 720 232 C980 196 1200 268 1440 222 V320 H0 Z" fill="#6fb36b" />
        <path d="M0 300 C300 262 620 310 940 282 C1160 262 1320 288 1440 276 V320 H0 Z" fill="#58a05d" />
        <path className="sk-path" d="M1030 320 C1010 290 1090 276 1060 252 C1030 228 930 236 960 206 C984 184 1060 190 1040 168" />
      </svg>

      <svg className="sk-trees sk-trees-l" viewBox="0 0 380 300">
        <Pine x={4} h={250} tone="#2f7d4b" delay={0} />
        <Oak x={92} r={52} tone="#4aa35f" delay={1.2} />
        <Pine x={196} h={190} tone="#3f9a5c" delay={2.4} />
        <Oak x={268} r={36} tone="#5fb36b" delay={0.6} />
      </svg>
      <svg className="sk-trees sk-trees-r" viewBox="0 0 380 300">
        <Oak x={10} r={40} tone="#5fb36b" delay={1.8} />
        <Pine x={92} h={220} tone="#2f7d4b" delay={0.4} />
        <Oak x={176} r={58} tone="#4aa35f" delay={2.2} />
        <Pine x={296} h={260} tone="#1f6a45" delay={1} />
      </svg>

      <svg className="sk-bench" viewBox="0 0 150 80">
        <path d="M118 78 V30 q0 -10 8 -10" stroke="#3b4a44" strokeWidth="3" fill="none" />
        <circle cx="128" cy="16" r="7" fill="#fff6c8" stroke="#3b4a44" strokeWidth="2" />
        <rect x="14" y="40" width="70" height="6" rx="2" fill="#a9733f" />
        <rect x="14" y="52" width="70" height="6" rx="2" fill="#8d5f33" />
        <rect x="14" y="26" width="70" height="6" rx="2" fill="#a9733f" />
        <rect x="18" y="26" width="5" height="52" rx="2" fill="#4a3a2a" />
        <rect x="74" y="26" width="5" height="52" rx="2" fill="#4a3a2a" />
      </svg>

      <svg className="sk-bird b1" viewBox="0 0 28 12"><path d="M1 8 Q7 0 14 7 Q21 0 27 8" /></svg>
      <svg className="sk-bird b2" viewBox="0 0 28 12"><path d="M1 8 Q7 0 14 7 Q21 0 27 8" /></svg>
      <svg className="sk-bird b3" viewBox="0 0 28 12"><path d="M1 8 Q7 0 14 7 Q21 0 27 8" /></svg>

      <svg className="sk-butterfly" viewBox="0 0 30 24">
        <g className="sk-wing"><path d="M15 12 C6 0 0 6 4 13 C6 17 12 16 15 12 Z" fill="#ffb347" /><path d="M15 12 C24 0 30 6 26 13 C24 17 18 16 15 12 Z" fill="#ff9d6b" /></g>
        <rect x="14.3" y="6" width="1.4" height="14" rx=".7" fill="#4a3a2a" />
      </svg>

      <i className="sk-leaf l1" /><i className="sk-leaf l2" /><i className="sk-leaf l3" /><i className="sk-leaf l4" /><i className="sk-leaf l5" /><i className="sk-leaf l6" />
    </div>
  );
}

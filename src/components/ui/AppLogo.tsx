import { motion } from 'motion/react';

export function CodebrainLogo({ size = 256, className = '' }: { size?: number; className?: string }) {
  const primary = '#4F46E5';
  const accent = '#60A5FA';

  return (
    <div
      className={`relative flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      <motion.svg
        width={size}
        height={size}
        viewBox="0 0 512 512"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      >
        <circle cx="256" cy="256" r="200" fill={primary} fillOpacity="0.05" />
        <motion.path
          d="M256 48L448 152V360L256 464L64 360V152L256 48Z"
          fill={primary}
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 1.5, ease: 'easeInOut' }}
        />
        <path
          d="M256 120V392M144 192H368M144 320H368"
          stroke={accent}
          strokeWidth="12"
          strokeLinecap="square"
          opacity="0.6"
        />
        <rect x="132" y="180" width="24" height="24" fill={accent} />
        <rect x="356" y="180" width="24" height="24" fill={accent} />
        <rect x="132" y="308" width="24" height="24" fill={accent} />
        <rect x="356" y="308" width="24" height="24" fill={accent} />
        <rect x="244" y="244" width="24" height="24" fill="white">
          <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />
        </rect>
        <path
          d="M200 400L220 420L200 440"
          stroke="white"
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.8"
        />
      </motion.svg>
    </div>
  );
}

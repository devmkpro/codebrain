import { motion } from 'motion/react';

export function CodebrainLogo({ size = 256, className = '' }: { size?: number; className?: string }) {
  const primary = '#5855e5';

  return (
    <div
      className={`relative flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      <motion.svg
        width={size}
        height={size}
        viewBox="0 0 200 200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      >
        {/* Outer brain/pill shape */}
        <motion.path
          d="M70 60 C 50 60, 40 80, 40 100 C 40 130, 60 150, 100 150 C 140 150, 160 130, 160 100 C 160 80, 150 60, 130 60 Z"
          fill="none"
          stroke={primary}
          strokeWidth="12"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 1.5, ease: 'easeInOut' }}
        />
        {/* Center divider */}
        <motion.path
          d="M100 60 L100 150"
          fill="none"
          stroke={primary}
          strokeWidth="12"
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.4, ease: 'easeInOut' }}
        />
        {/* Left chevron < */}
        <motion.path
          d="M75 90 L65 100 L75 110"
          fill="none"
          stroke={primary}
          strokeWidth="10"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.8, ease: 'easeInOut' }}
        />
        {/* Right chevron > */}
        <motion.path
          d="M125 90 L135 100 L125 110"
          fill="none"
          stroke={primary}
          strokeWidth="10"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.6, delay: 1.0, ease: 'easeInOut' }}
        />
      </motion.svg>
    </div>
  );
}

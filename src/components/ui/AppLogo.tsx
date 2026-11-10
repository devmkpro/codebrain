import { motion, useReducedMotion } from 'motion/react';

/* Os quatro traços do ícone do app (resources/icon.png). Fonte única: marca,
   logotipo animado e favicon de tela de login desenham a mesma geometria. */
const SHELL = 'M70 60 C 50 60, 40 80, 40 100 C 40 130, 60 150, 100 150 C 140 150, 160 130, 160 100 C 160 80, 150 60, 130 60 Z';
const DIVIDER = 'M100 60 L100 150';
const LEFT = 'M75 90 L65 100 L75 110';
const RIGHT = 'M125 90 L135 100 L125 110';
/* Recorte ao redor dos traços, para a marca ocupar a área pedida. */
const VIEWBOX = '30 50 140 110';

/**
 * A marca, parada. É esta que vai na interface; o `CodebrainLogo` animado fica
 * para aberturas. Cor por token: índigo da marca, ou `currentColor`.
 */
export function CodebrainMark({ size = 18, color = 'var(--cb-brand)', title, className }: {
  size?: number;
  color?: string;
  title?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={(size * 110) / 140}
      viewBox={VIEWBOX}
      fill="none"
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <path d={SHELL} strokeWidth="12" />
      <path d={DIVIDER} strokeWidth="12" />
      <path d={LEFT} strokeWidth="10" />
      <path d={RIGHT} strokeWidth="10" />
    </svg>
  );
}

/** "code" pesado, "brain" leve: a leitura em dois hemisférios do wordmark oficial. */
export function CodebrainWordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`whitespace-nowrap ${className}`}>
      <span className="font-bold text-cb-fg-0">code</span>
      <span className="font-normal text-cb-fg-2">brain</span>
    </span>
  );
}

export function CodebrainLogo({ size = 256, className = '' }: { size?: number; className?: string }) {
  const primary = 'var(--cb-brand)';
  const reduced = useReducedMotion();
  const draw = (duration: number, delay = 0) => ({
    initial: reduced ? false : { pathLength: 0, opacity: 0 },
    animate: { pathLength: 1, opacity: 1 },
    transition: { duration, delay, ease: 'easeInOut' as const },
  });

  return (
    <div
      className={`relative flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox="0 0 200 200" fill="none" stroke={primary} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <motion.path d={SHELL} strokeWidth="12" {...draw(1.1)} />
        <motion.path d={DIVIDER} strokeWidth="12" {...draw(0.6, 0.3)} />
        <motion.path d={LEFT} strokeWidth="10" {...draw(0.4, 0.6)} />
        <motion.path d={RIGHT} strokeWidth="10" {...draw(0.4, 0.75)} />
      </svg>
    </div>
  );
}

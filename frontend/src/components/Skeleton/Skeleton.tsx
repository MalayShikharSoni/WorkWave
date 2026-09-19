import React, { memo } from 'react';
import styles from './Skeleton.module.css';

export interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  /** Matches this app's asymmetric card radii when set (e.g. "13px" or "42px"). */
  borderRadius?: string | number;
  /**
   * `surface` — #ad9676 ↔ #bdab91 (card fill / hover circle tokens).
   * `onSurface` — #8b6c3e ↔ #9c815a (category / count-label accents on cards).
   */
  tone?: 'surface' | 'onSurface';
  className?: string;
  style?: React.CSSProperties;
}

const toCssSize = (value: string | number | undefined): string | undefined => {
  if (value === undefined) return undefined;
  return typeof value === 'number' ? `${value}px` : value;
};

/** Reusable shimmer placeholder — CSS animation only (not GSAP). */
const Skeleton = memo<SkeletonProps>(({
  width,
  height,
  borderRadius = 8,
  tone = 'surface',
  className,
  style,
}) => {
  const toneClass = tone === 'onSurface' ? styles.toneOnSurface : styles.toneSurface;

  return (
    <span
      className={[styles.bone, toneClass, className].filter(Boolean).join(' ')}
      aria-hidden="true"
      style={{
        width: toCssSize(width) ?? '100%',
        height: toCssSize(height) ?? '1rem',
        borderRadius: toCssSize(borderRadius),
        ...style,
      }}
    />
  );
});

Skeleton.displayName = 'Skeleton';
export default Skeleton;

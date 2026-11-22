import type { LucideIcon } from 'lucide-react';

type LandingIconSize = 'sm' | 'md' | 'lg';
type LandingIconVariant = 'soft' | 'solid';

interface LandingIconProps {
  icon: LucideIcon;
  size?: LandingIconSize;
  variant?: LandingIconVariant;
  className?: string;
}

/**
 * Consistent decorative icon treatment for the public YoungMoney3 home page.
 * Icons inherit foreground, background and border colors from the selected palette.
 * The accompanying text supplies the accessible label.
 */
export function LandingIcon({
  icon: Icon,
  size = 'md',
  variant = 'soft',
  className = '',
}: LandingIconProps) {
  return (
    <span
      className={['landing-icon', `landing-icon--${size}`, `landing-icon--${variant}`, className]
        .filter(Boolean)
        .join(' ')}
      aria-hidden="true"
    >
      <Icon className="landing-icon__glyph" strokeWidth={1.9} aria-hidden="true" focusable="false" />
    </span>
  );
}

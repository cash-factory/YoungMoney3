/** Selected Signal Monogram, refined from concept 01 into a scalable vector. */
export function BrandLogo({ className = '' }: { className?: string }) {
  return <span className={`ym-logo-mark ${className}`} aria-hidden="true"><img src="/visuals/youngmoney-mark.svg" className="ym-logo" alt="" width="40" height="40" /></span>;
}

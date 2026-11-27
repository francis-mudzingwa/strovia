// The Strovia mark: a rounded "S" that grows a small gold leaf, white on forest green. One shape used everywhere: the app
// header, the sign-in page, the browser tab (public/favicon.svg) and the phone icons (public/icon-*.png).
export function LogoMark({ size = 36, radius = 22, title = "Strovia" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={title} style={{ display: "block", flexShrink: 0 }}>
      <rect width="100" height="100" rx={radius} fill="#3F6C51" />
      <g transform="translate(9.5 13.5) scale(0.74)">
        <path d="M30 80C30 94 72 96 72 72C72 50 30 56 30 36C30 25 42 19 54 23" fill="none" stroke="#fff" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M54 23C54 10 66 5 80 8C80 22 68 28 54 23Z" fill="#E8BE5E" />
      </g>
    </svg>
  )
}

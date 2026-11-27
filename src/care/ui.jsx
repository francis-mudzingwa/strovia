// Shared look for the caregiver and family screens.
export const colors = {
  bg: "#FAF6EF", card: "#FFFFFF", hairline: "#E5DFD1", ink: "#20261F", inkSoft: "#5C6357", inkFaint: "#6B7266",
  sage: "#3F6C51", sageDeep: "#2C4E3A", sageTint: "#E3EBE0", gold: "#B98A2E", goldTint: "#F3E7CC",
  rust: "#A24632", rustTint: "#F3DAD2", teal: "#4C7A82", tealTint: "#E5EEEF",
}

export const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${colors.hairline}`, fontSize: 14, boxSizing: "border-box", background: "#fff", fontFamily: "inherit", color: colors.ink }
export const primaryButton = { padding: "10px 18px", borderRadius: 10, border: "none", background: colors.sage, color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }
export const quietButton = { padding: "8px 14px", borderRadius: 10, border: `1px solid ${colors.hairline}`, background: "#fff", color: colors.inkSoft, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }

export function Card({ children, style, className }) {
  return (
    <div className={className} style={{ background: colors.card, borderRadius: 18, boxShadow: "0 1px 3px rgba(32,38,31,0.06), 0 6px 16px rgba(32,38,31,0.05)", padding: 18, marginBottom: 16, ...style }}>
      {children}
    </div>
  )
}

// A finished card shrunk to one line: the title, what was done, and a chevron. Tapping it opens the full card again.
export function DoneRow({ icon: Icon, title, status, onClick, expanded }) {
  return (
    <button onClick={onClick} aria-expanded={expanded} style={{ display: "flex", width: "100%", alignItems: "center", gap: 10, textAlign: "left", background: colors.card, border: "none", borderRadius: 14, boxShadow: "0 1px 3px rgba(32,38,31,0.06), 0 6px 16px rgba(32,38,31,0.05)", padding: "12px 16px", marginBottom: 16, cursor: "pointer", fontFamily: "inherit" }}>
      <span style={{ width: 22, height: 22, borderRadius: 7, background: colors.sage, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: colors.ink, display: "flex", alignItems: "center", gap: 6 }}>{Icon && <Icon size={15} color={colors.sageDeep} />} {title}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: colors.sageDeep }}>{status}</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={colors.inkFaint} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: expanded ? "rotate(180deg)" : "none" }}><path d="m6 9 6 6 6-6" /></svg>
    </button>
  )
}

export const fmtTime = (d) => new Date(d).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
export const fmtWhen = (d) => new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })

export function ago(date, now = new Date()) {
  const mins = Math.max(0, Math.round((now - new Date(date)) / 60000))
  if (mins < 2) return "just now"
  if (mins < 60) return `${mins} minutes ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`
  const days = Math.floor(hours / 24)
  return `${days} ${days === 1 ? "day" : "days"} ago`
}

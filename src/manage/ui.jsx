// Shared look and small helpers for the Manage Accounts screens.
export const colors = {
  bg: "#FAF6EF", card: "#FFFFFF", hairline: "#E5DFD1", ink: "#20261F", inkSoft: "#5C6357", inkFaint: "#6B7266",
  sage: "#3F6C51", sageDeep: "#2C4E3A", sageTint: "#E3EBE0", gold: "#B98A2E", goldTint: "#F3E7CC",
  rust: "#A24632", rustTint: "#F3DAD2", teal: "#4C7A82", tealTint: "#E5EEEF",
}

export const ROLE_STYLE = {
  admin: { label: "Administrator", bg: colors.goldTint, fg: "#7A5A12" },
  caregiver: { label: "Caregiver", bg: colors.sageTint, fg: colors.sageDeep },
  relative: { label: "Family proxy", bg: colors.tealTint, fg: "#2F5A62" },
}

export const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${colors.hairline}`, fontSize: 14, boxSizing: "border-box", background: "#fff", fontFamily: "inherit", color: colors.ink }
export const smallButton = { border: `1px solid ${colors.hairline}`, background: "#fff", borderRadius: 9, padding: "7px 12px", fontSize: 13, fontWeight: 600, color: colors.inkSoft, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }
export const primaryButton = { ...smallButton, background: colors.sage, color: "#fff", border: "none" }
export const dangerButton = { ...smallButton, background: colors.rust, color: "#fff", border: "none" }
export const pill = (active) => ({ padding: "6px 13px", borderRadius: 999, border: `1px solid ${colors.hairline}`, cursor: "pointer", fontSize: 13, fontWeight: 600, background: active ? colors.sage : "#fff", color: active ? "#fff" : colors.inkSoft })

export function Card({ children, style }) {
  return <div style={{ background: colors.card, borderRadius: 18, boxShadow: "0 1px 3px rgba(32,38,31,0.06), 0 6px 16px rgba(32,38,31,0.05)", padding: 18, marginBottom: 14, ...style }}>{children}</div>
}

export function RoleBadge({ role }) {
  const s = ROLE_STYLE[role]
  if (!s) return <span style={{ fontSize: 12.5, fontWeight: 700, color: colors.inkFaint, background: colors.bg, padding: "2px 8px", borderRadius: 999 }}>No role</span>
  return <span style={{ fontSize: 12.5, fontWeight: 700, color: s.fg, background: s.bg, padding: "2px 8px", borderRadius: 999 }}>{s.label}</span>
}

const TONES = {
  gold: [colors.gold, "#fff"], rust: [colors.rust, "#fff"], grey: [colors.inkFaint, "#fff"],
  softRust: [colors.rustTint, colors.rust], softGold: [colors.goldTint, colors.gold], softTeal: [colors.tealTint, colors.teal],
}
export function Badge({ tone = "grey", children }) {
  const [bg, fg] = TONES[tone]
  return <span style={{ fontSize: 12.5, fontWeight: 700, color: fg, background: bg, padding: "2px 8px", borderRadius: 999 }}>{children}</span>
}

// A red dot with a number, for the tab bar.
export function Count({ n }) {
  if (!n) return null
  return <span style={{ minWidth: 16, height: 16, padding: "0 4px", boxSizing: "border-box", borderRadius: 999, background: colors.rust, color: "#fff", fontSize: 12.5, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{n}</span>
}

export const nameOf = (a) => [a.first_name, a.last_name].filter(Boolean).join(" ") || a.email
export const fmtWhen = (iso) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
export const fmtDay = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
export const DAY_MS = 86400000

// The message a Supabase Edge Function returned for an error status.
export async function functionError(error) {
  try { return (await error.context.json()).error || error.message } catch { return error.message }
}

export function Message({ message }) {
  if (!message) return null
  const bad = message.type === "error"
  return (
    <div style={{ background: bad ? colors.rustTint : colors.sageTint, color: bad ? colors.rust : colors.sageDeep, borderRadius: 11, padding: "10px 14px", fontSize: 13.5, marginBottom: 12, lineHeight: 1.45 }}>
      {message.text}
    </div>
  )
}

import { AlertTriangle, Phone, PhoneCall } from "lucide-react"
import { OFFICE_PHONE, telHref } from "./carePlan.js"

const colors = { ink: "#20261F", inkSoft: "#5C6357", gold: "#B98A2E", goldTint: "#F3E7CC", rust: "#A24632", rustTint: "#F3DAD2" }

// The only place "Call 911" and "Call the office" appear as buttons. It is shown when the check-ins
// show severe symptoms (emergency) or a steep fall in recovery / a sudden jump in a symptom (urgent).
export default function CallActions({ alert }) {
  const emergency = alert.level === "emergency"
  const accent = emergency ? colors.rust : colors.gold

  const call911 = (
    <a
      key="911"
      href="tel:911"
      style={{
        flex: "1 1 150px", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "13px 0", borderRadius: 12, textDecoration: "none", fontSize: 15, fontWeight: 700,
        ...(emergency ? { background: colors.rust, color: "#fff" } : { background: "#fff", color: colors.rust, border: `1px solid ${colors.rust}` }),
      }}
    >
      <PhoneCall size={17} /> Call 911
    </a>
  )
  const callOffice = (
    <a
      key="office"
      href={telHref(OFFICE_PHONE)}
      style={{
        flex: "1 1 190px", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "13px 0", borderRadius: 12, textDecoration: "none", fontSize: 15, fontWeight: 700,
        ...(emergency ? { background: "#fff", color: colors.ink, border: `1px solid ${colors.gold}` } : { background: colors.gold, color: "#fff" }),
      }}
    >
      <Phone size={17} /> Call the office · {OFFICE_PHONE}
    </a>
  )

  return (
    <div style={{ background: emergency ? colors.rustTint : colors.goldTint, border: `1px solid ${accent}`, borderRadius: 16, padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <AlertTriangle size={19} color={accent} style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 15, fontWeight: 700, color: emergency ? colors.rust : colors.ink }}>
          {emergency ? "Severe symptoms detected" : "Steep change in recovery detected"}
        </span>
      </div>
      <ul style={{ margin: "0 0 10px", padding: "0 0 0 18px" }}>
        {alert.reasons.map((r) => (
          <li key={r} style={{ fontSize: 13.5, color: colors.ink, lineHeight: 1.5 }}>{r}</li>
        ))}
      </ul>
      <p style={{ fontSize: 13, color: colors.inkSoft, lineHeight: 1.5, margin: "0 0 12px" }}>
        {emergency
          ? "If any of this came on suddenly or is new, call 911 now and note when it started. Then let the office know."
          : "Call the office about this change today. If symptoms turn sudden or severe, call 911 instead."}
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {emergency ? [call911, callOffice] : [callOffice, call911]}
      </div>
    </div>
  )
}

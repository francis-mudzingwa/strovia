import { useState } from "react"
import { ShieldAlert, ChevronDown, Phone, PhoneCall } from "lucide-react"
import { OFFICE_PHONE, telHref } from "../carePlan.js"
import { Card, colors } from "./ui.jsx"

// Everything needed in an emergency, in one tap: allergies, fall risk, who to call.
export default function EmergencyCard({ profile, plan }) {
  const [open, setOpen] = useState(false)
  const row = { display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 0", borderTop: `1px solid ${colors.hairline}`, fontSize: 13.5 }
  const label = { color: colors.inkFaint, flexShrink: 0 }
  const call = (phone, text) => phone
    ? <a href={telHref(phone)} style={{ color: colors.sageDeep, fontWeight: 700, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 5 }}><Phone size={13} /> {text || phone}</a>
    : <span style={{ color: colors.inkFaint }}>Not recorded</span>

  return (
    <Card className="no-print" style={{ padding: 14 }}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", border: "none", background: "none", cursor: "pointer", padding: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, color: colors.ink }}><ShieldAlert size={16} color={colors.rust} /> Emergency info</span>
        <ChevronDown size={16} color={colors.inkFaint} style={{ transform: open ? "rotate(180deg)" : "none" }} />
      </button>
      {open && (
        <div style={{ marginTop: 10 }}>
          <a href="tel:911" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px 0", borderRadius: 12, background: colors.rust, color: "#fff", fontWeight: 700, fontSize: 15, textDecoration: "none", marginBottom: 10 }}><PhoneCall size={17} /> Call 911</a>
          <div style={row}><span style={label}>Allergies</span><span style={{ textAlign: "right", color: colors.ink }}>{plan.allergies || "Not recorded"}</span></div>
          <div style={row}><span style={label}>Fall risk</span><span style={{ color: colors.ink, fontWeight: 700 }}>{plan.fallRisk || "Not recorded"}</span></div>
          <div style={row}><span style={label}>Emergency contact</span><span style={{ textAlign: "right" }}>{profile.emergencyName ? <>{profile.emergencyName}{profile.emergencyRelationship ? ` (${profile.emergencyRelationship})` : ""}<br /></> : null}{call(profile.emergencyPhone)}</span></div>
          <div style={row}><span style={label}>Doctor</span><span style={{ textAlign: "right", color: colors.ink }}>{profile.careProvider || "Not recorded"}</span></div>
          <div style={row}><span style={label}>The office</span>{call(OFFICE_PHONE)}</div>
          <div style={row}><span style={label}>Patient's phone</span>{call(profile.phone)}</div>
        </div>
      )}
    </Card>
  )
}

import { useState } from "react"
import { Check, X } from "lucide-react"
import { supabase } from "../supabaseClient.js"
import { Card, colors, inputStyle, primaryButton, dangerButton, RoleBadge, nameOf } from "./ui.jsx"
import { diffRequest } from "../ProfileRequests.jsx"

// Changes to name, job title, organisation or birthday that a caregiver or family member asked for after using their one
// self-service change. Approving applies them; rejecting leaves everything as it was, with an optional reason.
export default function ChangeRequests({ requests, accounts, onChanged }) {
  const [busy, setBusy] = useState(null)
  const [notes, setNotes] = useState({})
  const [error, setError] = useState(null)
  if (!requests || requests.length === 0) return null

  async function decide(r, approve) {
    setBusy(r.id)
    setError(null)
    const { error: err } = await supabase.rpc("decide_profile_change", { p_request: r.id, p_approve: approve, p_note: notes[r.id] || null })
    setBusy(null)
    if (err) { setError(err.message || "That did not work. Please try again."); return }
    await onChanged()
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 0.5, color: "#6B4D0E", textTransform: "uppercase", margin: "2px 2px 7px" }}>
        {requests.length} {requests.length === 1 ? "change request" : "change requests"}
      </div>
      {requests.map((r) => {
        const a = accounts.find((x) => x.user_id === r.user_id) || {}
        const rows = diffRequest(r)
        return (
          <Card key={r.id} style={{ padding: 14, border: `1.5px solid ${colors.gold}`, background: "#FFFDF6" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: colors.ink }}>{nameOf(a) || "Unknown person"}</span>
              <RoleBadge role={a.role} />
              <span style={{ fontSize: 12.5, color: colors.inkFaint }}>asked to change their details</span>
            </div>
            {rows.map(([label, from, to]) => (
              <div key={label} style={{ fontSize: 13.5, color: colors.ink, lineHeight: 1.5 }}>
                <strong>{label}:</strong> <span style={{ color: colors.inkSoft }}>{from}</span> to <strong>{to}</strong>
              </div>
            ))}
            <input value={notes[r.id] || ""} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} placeholder="Reason (shown to them if you reject)" maxLength={300} style={{ ...inputStyle, marginTop: 10 }} />
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button disabled={busy === r.id} onClick={() => decide(r, true)} style={{ ...primaryButton, flex: 1, justifyContent: "center", padding: "10px 12px", opacity: busy === r.id ? 0.6 : 1 }}><Check size={14} /> Approve</button>
              <button disabled={busy === r.id} onClick={() => decide(r, false)} style={{ ...dangerButton, flex: 1, justifyContent: "center", padding: "10px 12px", opacity: busy === r.id ? 0.6 : 1 }}><X size={14} /> Reject</button>
            </div>
          </Card>
        )
      })}
      {error && <p style={{ color: colors.rust, fontSize: 13, margin: "4px 0 0" }}>{error}</p>}
    </div>
  )
}

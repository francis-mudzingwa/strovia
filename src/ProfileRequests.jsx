import { useState } from "react"
import { supabase } from "./supabaseClient.js"
import { Card, colors } from "./care/ui.jsx"
import { birthdayText } from "./Birthdays.jsx"

const FIELDS = [["first_name", "First name"], ["last_name", "Last name"], ["job_title", "Job title"], ["organisation", "Organisation"]]

// What a change request would change: [label, now, requested] for each detail that differs.
export function diffRequest(req) {
  const cur = req.current || {}
  const next = req.requested || {}
  const rows = []
  for (const [k, label] of FIELDS) {
    if ((cur[k] || "") !== (next[k] || "")) rows.push([label, cur[k] || "none", next[k] || "none"])
  }
  if (cur.birthday_month !== next.birthday_month || cur.birthday_day !== next.birthday_day) {
    rows.push(["Birthday", birthdayText(cur.birthday_month, cur.birthday_day) || "none", birthdayText(next.birthday_month, next.birthday_day) || "none"])
  }
  return rows
}

// On Profile: a change request that is waiting, or the answer to the last one (until it is dismissed).
export function ProfileRequestNotice({ request, onDismiss }) {
  const [busy, setBusy] = useState(false)
  const pending = request.status === "pending"
  const approved = request.status === "approved"
  const [bg, fg] = pending ? [colors.goldTint, "#6B4D0E"] : approved ? [colors.sageTint, colors.sageDeep] : [colors.rustTint, "#7A2E1E"]
  async function dismiss() {
    setBusy(true)
    await supabase.rpc("dismiss_profile_request", { p_request: request.id })
    setBusy(false)
    onDismiss()
  }
  return (
    <div style={{ background: bg, borderRadius: 12, padding: "11px 13px", margin: "0 0 14px", color: fg, fontSize: 13.5, lineHeight: 1.5 }}>
      <strong>{pending ? "Your change is waiting for your administrator." : approved ? "Your change was approved." : "Your change was not approved."}</strong>
      {pending && diffRequest(request).map(([label, from, to]) => <div key={label} style={{ marginTop: 3 }}>{label}: {from} to {to}</div>)}
      {!pending && request.decision_note && <div style={{ marginTop: 3 }}>Note: {request.decision_note}</div>}
      {!pending && (
        <div style={{ marginTop: 6 }}>
          <button onClick={dismiss} disabled={busy} style={{ border: "none", background: "none", padding: 0, color: fg, fontWeight: 700, fontSize: 13, textDecoration: "underline", cursor: "pointer" }}>Dismiss</button>
        </div>
      )}
    </div>
  )
}

// On Profile (caregivers and administrators): turn the "you have a new message" emails on or off.
export function EmailNoticeSwitch({ on, busy, onChange }) {
  return (
    <Card style={{ padding: 20, marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: colors.inkFaint, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 10 }}>Email notices</div>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: busy ? "default" : "pointer", fontSize: 14.5, color: colors.ink, lineHeight: 1.45 }}>
        <input type="checkbox" checked={on} disabled={busy} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3, width: 18, height: 18 }} />
        <span>Email me when I get a message<br /><span style={{ fontSize: 13, color: colors.inkSoft }}>The email only says a message is waiting. It never shows the message. You read it in Strovia.</span></span>
      </label>
    </Card>
  )
}

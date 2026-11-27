import { useState } from "react"
import { Printer, Download, ShieldAlert } from "lucide-react"
import { colors, ROLE_STYLE, inputStyle, smallButton, pill, Card, RoleBadge, fmtWhen, DAY_MS } from "./ui.jsx"

const FAILED = "had a failed sign-in attempt"

// People with 3 or more failed sign-ins in the last 24 hours (someone may be guessing a password).
export function failedSignInAlerts(activity, now = Date.now()) {
  const by = {}
  for (const a of activity) {
    if (a.action !== FAILED || now - new Date(a.at) > DAY_MS) continue
    const key = a.actor_id || a.actor_name
    by[key] = by[key] || { name: a.actor_name || "Unknown", n: 0 }
    by[key].n++
  }
  return Object.values(by).filter((x) => x.n >= 3)
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))

function printAuditTrail({ rows, printedBy, description }) {
  const w = window.open("", "_blank")
  if (!w) return false
  const body = rows.map((a) => `
    <tr>
      <td class="when">${esc(fmtWhen(a.at))}</td>
      <td>${esc(a.actor_name || "Unknown")}<br><span class="muted">${esc(ROLE_STYLE[a.actor_role]?.label || "No role")}</span></td>
      <td>${esc(a.action)}${a.patient_name ? ` for <strong>${esc(a.patient_name)}</strong>` : ""}${a.detail ? `<div class="muted">${esc(a.detail)}</div>` : ""}</td>
      <td>${a.source === "auth" ? "Sign-in" : "Change"}</td>
    </tr>`).join("")
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Strovia audit trail</title>
    <style>
      body { font-family: Georgia, serif; color: #000; margin: 24px; }
      h1 { font-size: 22px; margin: 0 0 4px; }
      .meta { font-size: 12.5px; color: #333; margin: 0 0 14px; line-height: 1.5; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th { text-align: left; border-bottom: 2px solid #000; padding: 6px 8px; }
      td { border-bottom: 1px solid #bbb; padding: 6px 8px; vertical-align: top; }
      tr { page-break-inside: avoid; }
      .when { white-space: nowrap; }
      .muted { color: #555; font-size: 11.5px; }
      .foot { font-size: 11.5px; color: #333; margin-top: 16px; border-top: 1px solid #999; padding-top: 8px; }
    </style></head><body>
    <h1>Strovia - system audit trail</h1>
    <p class="meta">${esc(description)}<br>${rows.length} ${rows.length === 1 ? "entry" : "entries"}, newest first. Contains confidential information.</p>
    <table><thead><tr><th>When</th><th>Who</th><th>What happened</th><th>Type</th></tr></thead><tbody>${body}</tbody></table>
    <p class="foot">Printed by ${esc(printedBy)} on ${esc(fmtWhen(new Date().toISOString()))}.</p>
    </body></html>`)
  w.document.close()
  w.focus()
  w.print()
  return true
}

// A cell that starts with = + - or @ could run as a formula in a spreadsheet, so it is defused.
const csvCell = (v) => {
  let s = String(v ?? "")
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

function downloadCsv(rows) {
  const head = ["When", "Who", "Role", "Type", "What happened", "Patient", "Details"]
  const lines = rows.map((a) => [
    new Date(a.at).toLocaleString(undefined, { timeZoneName: "short" }), a.actor_name || "Unknown", ROLE_STYLE[a.actor_role]?.label || "No role",
    a.source === "auth" ? "Sign-in" : "Change", a.action, a.patient_name || "", a.detail || "",
  ].map(csvCell).join(","))
  const blob = new Blob(["﻿" + [head.map(csvCell).join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `strovia-audit-trail-${new Date().toLocaleDateString("en-CA")}.csv`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function AuditTab({ activity, onRefresh, printedBy }) {
  const [blocked, setBlocked] = useState(false)
  const [filter, setFilter] = useState("all")
  const [kind, setKind] = useState("all") // all | signin | changes
  const [person, setPerson] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const filters = [["all", "Everyone"], ["caregiver", "Caregivers"], ["relative", "Family proxies"], ["admin", "Administrators"]]
  const kinds = [["all", "Everything"], ["signin", "Sign-ins"], ["changes", "Changes"]]
  const isAccess = (a) => a.source === "auth"
  const people = [...new Set(activity.map((a) => a.actor_name).filter(Boolean))].sort()
  const start = from ? new Date(from + "T00:00:00") : null
  const end = to ? new Date(to + "T23:59:59.999") : null
  const shown = activity.filter((a) => {
    const at = new Date(a.at)
    return (filter === "all" || a.actor_role === filter) &&
      (kind === "all" || (kind === "signin" ? isAccess(a) : !isAccess(a))) &&
      (!person || a.actor_name === person) &&
      (!start || at >= start) && (!end || at <= end)
  })
  const alerts = failedSignInAlerts(activity)
  const describe = () => {
    const parts = [kinds.find(([k]) => k === kind)[1], filters.find(([k]) => k === filter)[1], person, from || to ? `${from || "start"} to ${to || "today"}` : ""].filter(Boolean)
    return `Showing: ${parts.join(" / ")}`
  }
  const oldest = activity.length ? activity[activity.length - 1].at : null

  return (
    <>
      {alerts.length > 0 && (
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", background: colors.rustTint, border: `1px solid ${colors.rust}`, borderRadius: 12, padding: "10px 14px", marginBottom: 12 }}>
          <ShieldAlert size={18} color={colors.rust} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, color: colors.ink, lineHeight: 1.5 }}>
            <strong style={{ color: colors.rust }}>Repeated failed sign-ins in the last 24 hours</strong>
            <div>{alerts.map((a) => `${a.name}: ${a.n} attempts`).join(" · ")}</div>
            <div style={{ color: colors.inkSoft }}>This can be someone forgetting a password, or someone guessing one. Consider a password reset or suspending the account.</div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8, alignItems: "center" }}>
        {kinds.map(([key, label]) => <button key={key} onClick={() => setKind(key)} style={pill(kind === key)}>{label}</button>)}
        <button onClick={onRefresh} style={{ ...smallButton, marginLeft: "auto" }}>Refresh</button>
        <button
          disabled={shown.length === 0}
          onClick={() => setBlocked(!printAuditTrail({ rows: shown, printedBy, description: describe() }))}
          style={{ ...smallButton, opacity: shown.length === 0 ? 0.5 : 1 }}
        >
          <Printer size={14} /> Print
        </button>
        <button disabled={shown.length === 0} onClick={() => downloadCsv(shown)} style={{ ...smallButton, opacity: shown.length === 0 ? 0.5 : 1 }}>
          <Download size={14} /> Export CSV
        </button>
      </div>
      {blocked && <p style={{ fontSize: 13, color: colors.rust, margin: "0 0 8px" }}>Your browser blocked the print window. Allow pop-ups for this site and press Print again.</p>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8, alignItems: "center" }}>
        {filters.map(([key, label]) => <button key={key} onClick={() => setFilter(key)} style={pill(filter === key)}>{label}</button>)}
        <select value={person} onChange={(e) => setPerson(e.target.value)} style={{ ...inputStyle, width: "auto", padding: "6px 10px", fontSize: 13 }}>
          <option value="">Everyone by name</option>
          {people.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center", fontSize: 13, color: colors.inkSoft }}>
        <span style={{ fontWeight: 700 }}>Dates</span>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" style={{ ...inputStyle, width: "auto", padding: "6px 10px", fontSize: 13 }} />
        <span>to</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" style={{ ...inputStyle, width: "auto", padding: "6px 10px", fontSize: 13 }} />
        {(from || to) && <button onClick={() => { setFrom(""); setTo("") }} style={{ ...smallButton, padding: "5px 10px" }}>Clear dates</button>}
      </div>
      <p style={{ fontSize: 13, color: colors.inkFaint, margin: "0 0 12px" }}>
        Showing {shown.length} of the latest {activity.length} entries{oldest ? `, back to ${fmtWhen(oldest)}` : ""}. Entries are kept.
      </p>

      {shown.length === 0 ? (
        <p style={{ fontSize: 13.5, color: colors.inkFaint }}>Nothing matches. Sign-ins, check-ins, notes, appointments, profile changes and care plan prints appear here.</p>
      ) : (
        shown.map((a, i) => (
          <Card key={`${a.at}-${i}`} style={{ padding: 14, marginBottom: 10, ...(isAccess(a) ? { background: colors.bg } : {}) }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 3 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: colors.ink }}>{a.actor_name || "Unknown"}</span>
              <RoleBadge role={a.actor_role} />
              {isAccess(a) && <span style={{ fontSize: 12.5, fontWeight: 700, color: colors.teal, background: colors.tealTint, padding: "2px 8px", borderRadius: 999 }}>Sign-in</span>}
              <span style={{ fontSize: 13, color: colors.inkFaint }}>{fmtWhen(a.at)}</span>
            </div>
            <div style={{ fontSize: 13.5, color: colors.ink }}>
              {a.action}{a.patient_name ? <> for <strong>{a.patient_name}</strong></> : ""}
            </div>
            {a.detail && <div style={{ fontSize: 13, color: colors.inkSoft, marginTop: 4, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{a.detail}</div>}
          </Card>
        ))
      )}
    </>
  )
}

import { useState } from "react"
import { Trash2, UserPlus, Copy, Check, X, Star, ChevronDown, Search, Archive, RotateCcw, ArrowRightLeft, Plus } from "lucide-react"
import { supabase } from "../supabaseClient.js"
import {
  colors, inputStyle, smallButton, primaryButton, dangerButton, pill, Card, Badge, nameOf, DAY_MS, Message,
} from "./ui.jsx"

const INVITE_DAYS = 7

function inviteState(i, now = Date.now()) {
  const left = INVITE_DAYS - (now - new Date(i.created_at)) / DAY_MS
  if (left <= 0) return { expired: true, text: "expired" }
  const days = Math.ceil(left)
  return { expired: false, text: `expires in ${days} ${days === 1 ? "day" : "days"}` }
}

const sectionLabel = { fontSize: 13, fontWeight: 700, color: colors.inkFaint, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }

function PatientDetails({ patient, userId, accounts, rows, invitations, shifts, onChanged }) {
  const [pickCaregiver, setPickCaregiver] = useState("")
  const [relName, setRelName] = useState("")
  const [relEmail, setRelEmail] = useState("")
  const [relRelationship, setRelRelationship] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(null)
  const [notice, setNotice] = useState(null)
  const [mode, setMode] = useState(null) // null | archive | delete
  const [typed, setTyped] = useState("")

  const byId = Object.fromEntries(accounts.map((a) => [a.user_id, a]))
  const assigned = rows.map((r) => r.user_id)
  const caregivers = rows.filter((r) => byId[r.user_id]?.role === "caregiver")
  const relatives = rows.filter((r) => byId[r.user_id]?.role === "relative")
  const available = accounts.filter((a) => a.role === "caregiver" && a.approved && !a.suspended && !assigned.includes(a.user_id))
  const pending = invitations.filter((i) => i.status === "pending")
  const archived = !!patient.archived_at

  async function run(action) {
    setBusy(true)
    setError(null)
    setNotice(null)
    const { error: err } = await action()
    setBusy(false)
    if (err) { setError(err.message); return false }
    await onChanged()
    return true
  }

  const assign = () => pickCaregiver && run(async () => {
    const result = await supabase.from("patient_assignments").insert({ patient_id: patient.id, user_id: pickCaregiver, assigned_by: userId })
    if (!result.error) setPickCaregiver("")
    return result
  })
  const unassign = (uid) => run(() => supabase.from("patient_assignments").delete().eq("patient_id", patient.id).eq("user_id", uid))
  const setPrimary = (uid, on) => run(() => supabase.rpc("admin_set_primary", { p_patient: patient.id, p_user: uid, p_primary: on }))
  const revoke = (id) => run(() => supabase.from("join_invitations").delete().eq("id", id))

  async function emailInvitation(id) {
    const { data, error: err } = await supabase.functions.invoke("send-mail", { body: { type: "invitation", invitationId: id } })
    return !err && data?.sent === 1
  }

  async function addRelative(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    const email = relEmail.trim().toLowerCase()
    const { data, error: err } = await supabase.from("join_invitations").insert({
      patient_id: patient.id, invitee_name: relName.trim(), invitee_email: email, relationship: relRelationship.trim() || null, created_by: userId,
    }).select("id").single()
    if (err) { setBusy(false); setError(err.message); return }
    const mailed = await emailInvitation(data.id)
    setNotice(mailed ? `The invitation was emailed to ${email}. It is valid for ${INVITE_DAYS} days.` : "The invitation was created, but the email couldn't be sent. Use Copy link and send it yourself.")
    setRelName(""); setRelEmail(""); setRelRelationship("")
    setBusy(false)
    onChanged()
  }

  async function resendInvitation(i, renew) {
    setBusy(true)
    setError(null)
    setNotice(null)
    if (renew) {
      const { error: err } = await supabase.from("join_invitations").update({ created_at: new Date().toISOString() }).eq("id", i.id)
      if (err) { setBusy(false); setError(err.message); return }
    }
    const mailed = await emailInvitation(i.id)
    setNotice(mailed ? `The invitation was emailed to ${i.invitee_email}${renew ? " and is valid for another 7 days" : ""}.` : "The email couldn't be sent right now. Use Copy link instead.")
    setBusy(false)
    if (renew) onChanged()
  }

  async function copyLink(inv) {
    const link = `${window.location.origin}/?join=${inv.token}`
    try { await navigator.clipboard.writeText(link) } catch { window.prompt("Copy this link:", link) }
    setCopied(inv.id)
    setTimeout(() => setCopied(null), 2000)
  }

  const iconButton = { border: "none", background: "none", cursor: "pointer", color: colors.inkFaint, display: "flex" }
  const rowStyle = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "7px 0", borderBottom: `1px solid ${colors.hairline}` }
  const shiftCount = shifts.filter((s) => s.patient_id === patient.id).length

  return (
    <div>
      <div style={sectionLabel}>Caregivers</div>
      {caregivers.length === 0 && <p style={{ fontSize: 13, color: colors.rust, fontWeight: 600, margin: "0 0 4px" }}>No caregiver assigned yet.</p>}
      {caregivers.map((r) => {
        const a = byId[r.user_id]
        return (
          <div key={r.user_id} style={rowStyle}>
            <span style={{ fontSize: 13.5, color: colors.ink }}>
              {nameOf(a)} <span style={{ fontSize: 13, color: colors.inkFaint }}>{a.company_id || a.email}</span>
              {r.is_primary && <span style={{ marginLeft: 6 }}><Badge tone="softGold">Primary</Badge></span>}
              {a.suspended && <span style={{ marginLeft: 6 }}><Badge tone="rust">Suspended</Badge></span>}
            </span>
            <span style={{ display: "flex", gap: 4 }}>
              <button onClick={() => setPrimary(r.user_id, !r.is_primary)} disabled={busy} aria-label={r.is_primary ? "Remove primary" : "Make primary caregiver"} title={r.is_primary ? "Primary caregiver (tap to remove)" : "Make primary caregiver"} style={{ ...iconButton, color: r.is_primary ? colors.gold : colors.inkFaint }}>
                <Star size={16} fill={r.is_primary ? colors.gold : "none"} />
              </button>
              <button onClick={() => unassign(r.user_id)} disabled={busy} aria-label={`Remove ${nameOf(a)}`} style={iconButton}><X size={15} /></button>
            </span>
          </div>
        )
      })}
      {!archived && (
        <div style={{ display: "flex", gap: 8, margin: "10px 0 16px" }}>
          <select value={pickCaregiver} onChange={(e) => setPickCaregiver(e.target.value)} style={inputStyle} disabled={available.length === 0}>
            <option value="">{available.length === 0 ? "No more caregivers to assign" : "Choose a caregiver to assign"}</option>
            {available.map((a) => <option key={a.user_id} value={a.user_id}>{nameOf(a)}{a.company_id ? ` (${a.company_id})` : ""}</option>)}
          </select>
          <button onClick={assign} disabled={busy || !pickCaregiver} style={{ ...primaryButton, flexShrink: 0, opacity: busy || !pickCaregiver ? 0.6 : 1 }}>Assign</button>
        </div>
      )}

      <div style={{ ...sectionLabel, marginTop: archived ? 14 : 0 }}>Family proxies</div>
      {relatives.length === 0 && pending.length === 0 && <p style={{ fontSize: 13, color: colors.inkFaint, margin: "0 0 4px" }}>No family proxy added yet.</p>}
      {relatives.map((r) => {
        const a = byId[r.user_id]
        return (
          <div key={r.user_id} style={rowStyle}>
            <span style={{ fontSize: 13.5, color: colors.ink }}>{nameOf(a)} <span style={{ fontSize: 13, color: colors.inkFaint }}>{a.email}</span></span>
            <button onClick={() => unassign(r.user_id)} disabled={busy} aria-label={`Remove ${nameOf(a)}`} style={iconButton}><X size={15} /></button>
          </div>
        )
      })}
      {pending.map((i) => {
        const st = inviteState(i)
        return (
          <div key={i.id} style={{ ...rowStyle, alignItems: "flex-start" }}>
            <span style={{ fontSize: 13.5, color: colors.ink }}>
              {i.invitee_name} <span style={{ fontSize: 13, color: st.expired ? colors.rust : colors.gold, fontWeight: 600 }}>{st.expired ? "invitation expired" : "invited, not joined yet"}</span>
              <span style={{ display: "block", fontSize: 13, color: colors.inkFaint }}>{i.invitee_email}{i.relationship ? ` · ${i.relationship}` : ""} · {st.text}</span>
            </span>
            <span style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {st.expired ? (
                <button onClick={() => resendInvitation(i, true)} disabled={busy} style={primaryButton}>Renew and email</button>
              ) : (
                <>
                  <button onClick={() => resendInvitation(i, false)} disabled={busy} style={smallButton}>Email again</button>
                  <button onClick={() => copyLink(i)} style={smallButton}>{copied === i.id ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy link</>}</button>
                </>
              )}
              <button onClick={() => revoke(i.id)} disabled={busy} aria-label="Cancel invitation" style={iconButton}><X size={15} /></button>
            </span>
          </div>
        )
      })}

      {!archived && (
        <form onSubmit={addRelative} style={{ marginTop: 12, background: colors.bg, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: colors.ink, marginBottom: 8 }}>Add a family proxy</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
            <input required value={relName} onChange={(e) => setRelName(e.target.value)} placeholder="Full name" style={inputStyle} />
            <input value={relRelationship} onChange={(e) => setRelRelationship(e.target.value)} placeholder="Relationship (e.g. Daughter)" style={inputStyle} />
          </div>
          <input required type="email" value={relEmail} onChange={(e) => setRelEmail(e.target.value)} placeholder="Their email address" style={{ ...inputStyle, marginBottom: 8 }} />
          <button type="submit" disabled={busy} style={primaryButton}><UserPlus size={13} /> {busy ? "Sending..." : "Send invitation"}</button>
          <p style={{ fontSize: 13, color: colors.inkFaint, margin: "8px 0 0", lineHeight: 1.45 }}>
            We email them a link that works for {INVITE_DAYS} days. They set a password and can then do everything a caregiver can for this patient, so they can take over when the caregiver is away. You can also copy the link and send it yourself.
          </p>
        </form>
      )}
      {notice && <p style={{ color: colors.sageDeep, background: colors.sageTint, borderRadius: 9, padding: "8px 12px", fontSize: 13, margin: "10px 0 0" }}>{notice}</p>}
      {error && <p style={{ color: colors.rust, fontSize: 13, margin: "10px 0 0" }}>{error}</p>}

      <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${colors.hairline}`, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {archived ? (
          <>
            <button onClick={() => run(() => supabase.rpc("admin_archive_patient", { p_patient: patient.id, p_archive: false }))} disabled={busy} style={primaryButton}><RotateCcw size={13} /> Restore patient</button>
            <button onClick={() => setMode(mode === "delete" ? null : "delete")} style={{ ...smallButton, color: colors.rust }}><Trash2 size={13} /> Delete permanently</button>
          </>
        ) : (
          <button onClick={() => setMode(mode === "archive" ? null : "archive")} style={{ ...smallButton, color: "#7A5A12" }}><Archive size={13} /> Archive patient</button>
        )}
      </div>

      {mode === "archive" && (
        <div style={{ background: colors.goldTint, borderRadius: 12, padding: 12, marginTop: 10, fontSize: 13, color: colors.ink, lineHeight: 1.5 }}>
          Archive <strong>{patient.full_name}</strong>? They disappear from everyone's lists, and their caregivers and family proxies lose access, until you restore them. Nothing is deleted: check-ins, notes, appointments, the care plan{shiftCount ? ` and ${shiftCount} ${shiftCount === 1 ? "shift" : "shifts"}` : ""} are all kept, and appointment reminders stop.
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button onClick={async () => { if (await run(() => supabase.rpc("admin_archive_patient", { p_patient: patient.id, p_archive: true }))) setMode(null) }} disabled={busy} style={{ ...dangerButton, background: colors.gold }}>Yes, archive</button>
            <button onClick={() => setMode(null)} style={smallButton}>Keep active</button>
          </div>
        </div>
      )}
      {mode === "delete" && (
        <div style={{ background: colors.rustTint, borderRadius: 12, padding: 12, marginTop: 10, fontSize: 13, color: colors.ink, lineHeight: 1.5 }}>
          <strong>This permanently deletes {patient.full_name}</strong> with all their check-ins, appointments, notes, shifts and records of what was done. It cannot be undone. Type their full name to confirm.
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={patient.full_name} style={{ ...inputStyle, marginTop: 8 }} />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button onClick={() => run(() => supabase.from("patients").delete().eq("id", patient.id))} disabled={busy || typed.trim() !== patient.full_name} style={{ ...dangerButton, opacity: busy || typed.trim() !== patient.full_name ? 0.5 : 1 }}>Delete for good</button>
            <button onClick={() => { setMode(null); setTyped("") }} style={smallButton}>Keep</button>
          </div>
        </div>
      )}
    </div>
  )
}

// Caregiver leaving or changing? Move all their patients and shifts to someone else in one step.
function ReassignCard({ accounts, assignments, patients, shifts, onChanged }) {
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)

  const caregivers = accounts.filter((a) => a.role === "caregiver")
  const targets = caregivers.filter((a) => a.approved && !a.suspended && a.user_id !== from)
  const activeIds = new Set(patients.filter((p) => !p.archived_at).map((p) => p.id))
  const movingPatients = from ? assignments.filter((x) => x.user_id === from && activeIds.has(x.patient_id)).length : 0
  const movingShifts = from ? shifts.filter((s) => s.caregiver_id === from).length : 0
  const nameById = (id) => nameOf(accounts.find((a) => a.user_id === id) || { email: "" })

  async function move() {
    setBusy(true)
    setMessage(null)
    const { data, error } = await supabase.rpc("admin_reassign_caregiver", { p_from: from, p_to: to })
    setBusy(false)
    setConfirming(false)
    if (error) { setMessage({ type: "error", text: error.message }); return }
    setMessage({ type: "ok", text: `Moved ${data.patients} ${data.patients === 1 ? "patient" : "patients"} and ${data.shifts} ${data.shifts === 1 ? "shift" : "shifts"} from ${nameById(from)} to ${nameById(to)}.` })
    setFrom(""); setTo("")
    await onChanged()
  }

  return (
    <Card style={{ padding: 14 }}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", border: "none", background: "none", cursor: "pointer", padding: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, color: colors.ink }}>
          <ArrowRightLeft size={16} color={colors.sageDeep} /> Caregiver leaving? Move their patients
        </span>
        <ChevronDown size={16} color={colors.inkFaint} style={{ transform: open ? "rotate(180deg)" : "none" }} />
      </button>
      {open && (
        <div style={{ marginTop: 12 }}>
          <Message message={message} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
            <label>
              <span style={{ ...sectionLabel, display: "block" }}>Move everything from</span>
              <select value={from} onChange={(e) => { setFrom(e.target.value); setTo(""); setConfirming(false) }} style={inputStyle}>
                <option value="">Choose a caregiver</option>
                {caregivers.map((a) => <option key={a.user_id} value={a.user_id}>{nameOf(a)}</option>)}
              </select>
            </label>
            <label>
              <span style={{ ...sectionLabel, display: "block" }}>To</span>
              <select value={to} onChange={(e) => { setTo(e.target.value); setConfirming(false) }} disabled={!from} style={inputStyle}>
                <option value="">Choose a caregiver</option>
                {targets.map((a) => <option key={a.user_id} value={a.user_id}>{nameOf(a)}</option>)}
              </select>
            </label>
          </div>
          {from && (
            <p style={{ fontSize: 13, color: colors.inkSoft, margin: "10px 0 0", lineHeight: 1.5 }}>
              {nameById(from)} has <strong>{movingPatients}</strong> {movingPatients === 1 ? "patient" : "patients"} and <strong>{movingShifts}</strong> {movingShifts === 1 ? "shift" : "shifts"}.
            </p>
          )}
          {from && to && !confirming && (
            <button onClick={() => setConfirming(true)} disabled={movingPatients === 0 && movingShifts === 0} style={{ ...primaryButton, marginTop: 10, opacity: movingPatients === 0 && movingShifts === 0 ? 0.5 : 1 }}>Review the move</button>
          )}
          {confirming && (
            <div style={{ background: colors.goldTint, borderRadius: 12, padding: 12, marginTop: 10, fontSize: 13, color: colors.ink, lineHeight: 1.5 }}>
              Move {movingPatients} {movingPatients === 1 ? "patient" : "patients"} and {movingShifts} {movingShifts === 1 ? "shift" : "shifts"} from <strong>{nameById(from)}</strong> to <strong>{nameById(to)}</strong>? {nameById(from)} will no longer see these patients. If {nameById(to)} already has a shift at any of those times, nothing is moved and you will be told which one.
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button onClick={move} disabled={busy} style={primaryButton}>{busy ? "Moving..." : "Yes, move them"}</button>
                <button onClick={() => setConfirming(false)} style={smallButton}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

export default function PatientsTab({ userId, patients, accounts, assignments, invitations, shifts, onChanged, onPatientAdded }) {
  const [newName, setNewName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [view, setView] = useState("active") // active | nocaregiver | archived
  const [query, setQuery] = useState("")
  const [openId, setOpenId] = useState(null)
  const [adding, setAdding] = useState(false)

  const byId = Object.fromEntries(accounts.map((a) => [a.user_id, a]))
  const rowsFor = (id) => assignments.filter((x) => x.patient_id === id)
  const caregiverCount = (id) => rowsFor(id).filter((r) => byId[r.user_id]?.role === "caregiver").length
  const relativeCount = (id) => rowsFor(id).filter((r) => byId[r.user_id]?.role === "relative").length
  const active = patients.filter((p) => !p.archived_at)
  const archived = patients.filter((p) => p.archived_at)
  const noCaregiver = active.filter((p) => caregiverCount(p.id) === 0)

  async function addPatient(e) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    setError(null)
    const { data, error: err } = await supabase.from("patients").insert({ full_name: name, profile: { fullName: name }, created_by: userId }).select("id").single()
    setBusy(false)
    if (err) { setError(err.message); return }
    setNewName("")
    setAdding(false)
    await onChanged()
    if (data) onPatientAdded?.(data.id)
  }

  const q = query.trim().toLowerCase()
  const list = (view === "archived" ? archived : view === "nocaregiver" ? noCaregiver : active).filter((p) => !q || p.full_name.toLowerCase().includes(q))

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <Search size={14} color={colors.inkFaint} style={{ position: "absolute", left: 12, top: 12 }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search patients" style={{ ...inputStyle, paddingLeft: 34, borderRadius: 999 }} />
        </div>
        <button onClick={() => setAdding((a) => !a)} aria-expanded={adding} style={{ ...primaryButton, flexShrink: 0, padding: "9px 16px" }}><Plus size={14} /> Add</button>
      </div>
      {adding && (
        <Card>
          <div style={{ fontSize: 14, fontWeight: 700, color: colors.ink, marginBottom: 8 }}>Add a patient</div>
          <form onSubmit={addPatient} style={{ display: "flex", gap: 8 }}>
            <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Patient's full name" style={inputStyle} />
            <button type="submit" disabled={busy || !newName.trim()} style={{ ...primaryButton, flexShrink: 0, opacity: busy || !newName.trim() ? 0.6 : 1 }}>
              <UserPlus size={14} /> Add
            </button>
          </form>
          {error && <p style={{ color: colors.rust, fontSize: 12.5, margin: "8px 0 0" }}>{error}</p>}
        </Card>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <button onClick={() => setView("active")} style={pill(view === "active")}>Active ({active.length})</button>
        <button onClick={() => setView("nocaregiver")} style={pill(view === "nocaregiver")}>No caregiver ({noCaregiver.length})</button>
        <button onClick={() => setView("archived")} style={pill(view === "archived")}>Archived ({archived.length})</button>
      </div>

      {list.length === 0 && (
        <p style={{ fontSize: 13.5, color: colors.inkFaint }}>
          {view === "archived" ? "No archived patients." : view === "nocaregiver" ? "Every patient has a caregiver." : q ? "No patients match." : "No patients yet."}
        </p>
      )}
      {list.map((p) => {
        const open = openId === p.id
        const cg = caregiverCount(p.id)
        const fp = relativeCount(p.id)
        return (
          <Card key={p.id} style={{ padding: 0, overflow: "hidden" }}>
            <button onClick={() => setOpenId(open ? null : p.id)} aria-expanded={open} style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "14px 16px", border: "none", background: "none", cursor: "pointer", textAlign: "left" }}>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: "block", fontFamily: "Fraunces, Georgia, serif", fontSize: 17, fontWeight: 600, color: colors.ink }}>
                  {p.full_name} {p.archived_at && <Badge tone="grey">Archived</Badge>}
                </span>
                <span style={{ display: "block", fontSize: 13, marginTop: 2, color: cg === 0 ? colors.rust : colors.inkSoft, fontWeight: cg === 0 ? 700 : 400 }}>
                  {cg === 0 ? "No caregiver assigned" : rowsFor(p.id).filter((r) => byId[r.user_id]?.role === "caregiver").map((r) => nameOf(byId[r.user_id])).join(", ")}{fp ? ` · Family: ${rowsFor(p.id).filter((r) => byId[r.user_id]?.role === "relative").map((r) => nameOf(byId[r.user_id])).join(", ")}` : ""}
                </span>
              </span>
              {!p.archived_at && (
                cg === 0 ? <Badge tone="softRust">No caregiver</Badge>
                  : !shifts.some((s) => s.patient_id === p.id) ? <Badge tone="softGold">No shifts yet</Badge>
                  : <Badge tone="softTeal">Set up</Badge>
              )}
              <ChevronDown size={18} color={colors.inkFaint} style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "none" }} />
            </button>
            {open && (
              <div style={{ padding: "0 16px 16px", borderTop: `1px solid ${colors.hairline}`, paddingTop: 14 }}>
                <PatientDetails patient={p} userId={userId} accounts={accounts} rows={rowsFor(p.id)} invitations={invitations.filter((i) => i.patient_id === p.id)} shifts={shifts} onChanged={onChanged} />
              </div>
            )}
          </Card>
        )
      })}

      <div style={{ marginTop: 16 }}>
        <ReassignCard accounts={accounts} assignments={assignments} patients={patients} shifts={shifts} onChanged={onChanged} />
      </div>
    </>
  )
}

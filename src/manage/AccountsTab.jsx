import { useState } from "react"
import { MessageSquare, Camera, Trash2, Check, ChevronDown, Pencil, Mail, KeyRound, Ban, RotateCcw, Search, ShieldPlus, ShieldMinus } from "lucide-react"
import { supabase } from "../supabaseClient.js"
import { Avatar } from "../Avatar.jsx"
import { BirthdayFields } from "../Birthdays.jsx"
import ChangeRequests from "./ChangeRequests.jsx"
import { weeklyMinutes, fmtDuration } from "../shifts.js"
import {
  colors, inputStyle, smallButton, primaryButton, dangerButton, pill, Card, RoleBadge, Badge, nameOf, fmtWhen, DAY_MS, functionError, Message,
} from "./ui.jsx"

// "3 hours ago", "yesterday": short and plain, for the compact account lines.
function sinceText(iso) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000))
  if (mins < 2) return "just now"
  if (mins < 60) return `${mins} minutes ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? "yesterday" : `${days} days ago`
}

export const isPending = (a) => !!a.role && !a.approved && !a.suspended
const isActive = (a) => !!a.role && a.approved && !a.suspended

// Why an account deserves a look: it never got verified, or it has gone quiet.
export function attentionReasons(a, now = Date.now()) {
  const out = []
  if (!a.confirmed && now - new Date(a.created_at) > DAY_MS) out.push("Email still not verified after a day")
  if (a.role && a.role !== "admin" && a.approved && !a.suspended) {
    if (!a.last_sign_in_at) {
      if (now - new Date(a.created_at) > 7 * DAY_MS) out.push("Has never signed in")
    } else if (now - new Date(a.last_sign_in_at) > 30 * DAY_MS) {
      out.push("Has not signed in for over 30 days")
    }
  }
  return out
}

const labelStyle = { fontSize: 13, fontWeight: 700, color: colors.inkSoft, display: "block", marginBottom: 4 }

function EditForm({ account, busy, onSave, onCancel }) {
  const [f, setF] = useState({
    first: account.first_name || "", last: account.last_name || "", job: account.job_title || "", phone: account.phone || "",
    org: account.organisation || "", cid: account.company_id || "",
    bMonth: account.birthday_month || "", bDay: account.birthday_day || "",
  })
  const set = (key) => (e) => setF((x) => ({ ...x, [key]: e.target.value }))
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(f) }} style={{ background: colors.bg, borderRadius: 12, padding: 12, marginTop: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        <label><span style={labelStyle}>First name</span><input required value={f.first} onChange={set("first")} style={inputStyle} /></label>
        <label><span style={labelStyle}>Last name</span><input value={f.last} onChange={set("last")} style={inputStyle} /></label>
        <label><span style={labelStyle}>Job title</span><input value={f.job} onChange={set("job")} style={inputStyle} /></label>
        <label><span style={labelStyle}>Phone</span><input type="tel" value={f.phone} onChange={set("phone")} style={inputStyle} /></label>
        <label><span style={labelStyle}>Organisation</span><input value={f.org} onChange={set("org")} style={inputStyle} /></label>
        {account.role !== "relative" && (
          <BirthdayFields required month={f.bMonth} day={f.bDay} onChange={(m, d) => setF((x) => ({ ...x, bMonth: m, bDay: d }))} selectStyle={inputStyle} labelStyle={labelStyle} />
        )}
        {account.role === "caregiver" && (
          <label><span style={labelStyle}>Company ID</span><input value={f.cid} onChange={set("cid")} placeholder="C4XXXXX" style={inputStyle} /></label>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button type="submit" disabled={busy} style={{ ...primaryButton, opacity: busy ? 0.6 : 1 }}>{busy ? "Saving..." : "Save changes"}</button>
        <button type="button" onClick={onCancel} style={smallButton}>Cancel</button>
      </div>
    </form>
  )
}

function AccountCard({ a, isMe, open, onToggle, selected, onSelect, busy, actions, patientNames, shiftList, adminCount, onMessage }) {
  const [mode, setMode] = useState(null) // null | edit | suspend | delete | promote | demote
  const pending = isPending(a)
  const reasons = attentionReasons(a)
  const weekly = weeklyMinutes(shiftList.filter((s) => s.weekday !== null && s.weekday !== undefined))
  const oneOff = shiftList.filter((s) => s.on_date).length
  const canManage = !isMe && a.role !== "admin"
  const canPromote = !isMe && a.role === "caregiver" && a.approved && !a.suspended
  const canDemote = !isMe && a.role === "admin"
  const dim = a.suspended ? { opacity: 0.75 } : {}

  return (
    <Card style={{ padding: 14, ...(pending ? { border: `1.5px solid ${colors.gold}`, background: "#FFFDF6" } : {}), ...dim }}>
      {pending && <div style={{ fontSize: 11.5, fontWeight: 700, color: "#6B4D0E", letterSpacing: 0.5, marginBottom: 6 }}>WAITING FOR APPROVAL</div>}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        {pending && (
          <input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Select ${nameOf(a)}`} style={{ marginTop: 4, width: 17, height: 17, flexShrink: 0 }} />
        )}
        <Avatar userId={a.user_id} name={nameOf(a)} size={38} fontSize={14} />
        <button onClick={() => onToggle(!open)} aria-expanded={open} style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit", color: "inherit" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: colors.ink }}>{nameOf(a)}</span>
            <RoleBadge role={a.role} />
            {a.suspended && <Badge tone="rust">Suspended</Badge>}
            {a.role === "caregiver" && a.approved && !a.suspended && patientNames.length === 0 && <Badge tone="softGold">No patients yet</Badge>}
            {!a.confirmed && <Badge tone="softRust">Email not verified</Badge>}
            {isMe && <span style={{ fontSize: 12.5, color: colors.inkFaint }}>(you)</span>}
          </div>
          <div style={{ fontSize: 13, color: colors.inkSoft, marginTop: 3, wordBreak: "break-all" }}>
            {pending ? `${a.email} · Joined ${new Date(a.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : a.last_sign_in_at ? `Signed in ${sinceText(a.last_sign_in_at)}` : "Has not signed in yet"}
          </div>
          {reasons.filter((r) => !r.startsWith("Email still")).map((r) => (
            <div key={r} style={{ fontSize: 13, color: "#7A5A12", fontWeight: 600, marginTop: 3 }}>{r}</div>
          ))}
        </button>
        <button onClick={() => onToggle(!open)} aria-label={open ? "Hide details" : "Show details"} style={{ border: "none", background: "none", padding: 4, cursor: "pointer", color: colors.inkFaint, display: "flex", flexShrink: 0 }}>
          <ChevronDown size={18} style={{ transform: open ? "rotate(180deg)" : "none" }} />
        </button>
      </div>

      {pending && (
        <>
          {!a.confirmed && (
            <div style={{ fontSize: 13, fontWeight: 600, color: colors.rust, marginTop: 8, lineHeight: 1.45 }}>
              You can approve now, but they can't log in until they click the link in the email Strovia sent them (ask them to check spam).
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button onClick={() => actions.approve(a)} disabled={busy} style={{ ...primaryButton, flex: 1, justifyContent: "center", padding: "10px 12px", opacity: busy ? 0.6 : 1 }}><Check size={14} /> Approve</button>
            <button onClick={() => { onToggle(true); setMode("delete") }} style={{ ...smallButton, flex: 1, justifyContent: "center", padding: "10px 12px", color: colors.rust, borderColor: colors.rust }}><Trash2 size={14} /> Reject</button>
          </div>
        </>
      )}
      {a.suspended && (
        <button onClick={() => actions.suspend(a, false)} disabled={busy} style={{ ...primaryButton, marginTop: 10, opacity: busy ? 0.6 : 1 }}><RotateCcw size={13} /> Reactivate</button>
      )}

      {open && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${colors.hairline}` }}>
          <div style={{ fontSize: 13, color: colors.inkSoft, lineHeight: 1.6, marginBottom: 12, wordBreak: "break-word" }}>
            <div>{a.email}</div>
            <div>{[a.company_id, a.organisation, a.job_title, a.phone].filter(Boolean).join(" · ") || "No registration details"}</div>
            <div>Joined {fmtWhen(a.created_at)} · {a.last_sign_in_at ? `Last signed in ${fmtWhen(a.last_sign_in_at)}` : "Has not signed in yet"}</div>
            {!a.confirmed && !pending && <div style={{ fontWeight: 600, color: colors.rust }}>They can't log in until they click the link in the email Strovia sent them.</div>}
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: colors.inkFaint, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>What they can access</div>
          <div style={{ fontSize: 13, color: colors.ink, lineHeight: 1.5 }}>
            {a.role === "admin" ? "Everything (administrator)." : patientNames.length ? <>Patients: <strong>{patientNames.join(", ")}</strong></> : "No patients assigned."}
            {a.suspended && <> <span style={{ color: colors.rust }}>Access is switched off while suspended.</span></>}
          </div>
          {a.role === "caregiver" && (
            <div style={{ fontSize: 13, color: colors.inkSoft, marginTop: 2 }}>
              Shifts: {shiftList.length === 0 ? "none" : `${weekly ? `${fmtDuration(weekly)} a week` : "no weekly shifts"}${oneOff ? `, ${oneOff} one-day` : ""}`}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            {onMessage && !isMe && a.role !== "relative" && a.approved && !a.suspended && (
              <button onClick={() => onMessage(a.user_id)} style={{ ...smallButton, color: colors.sageDeep }}><MessageSquare size={13} /> Message</button>
            )}
            <button onClick={() => setMode(mode === "edit" ? null : "edit")} style={smallButton}><Pencil size={13} /> Edit details</button>
            {a.avatar_path && !isMe && (
              <button onClick={() => actions.clearPhoto(a)} disabled={busy} style={smallButton}><Camera size={13} /> Remove photo</button>
            )}
            {!a.confirmed && (
              <button onClick={() => actions.resendVerification(a)} disabled={busy} style={smallButton}><Mail size={13} /> Resend verification email</button>
            )}
            {a.confirmed && (
              <button onClick={() => actions.resetPassword(a)} disabled={busy} style={smallButton}><KeyRound size={13} /> Send password reset</button>
            )}
            {canManage && a.approved && !a.suspended && (
              <button onClick={() => setMode(mode === "suspend" ? null : "suspend")} style={{ ...smallButton, color: "#7A5A12" }}><Ban size={13} /> Suspend</button>
            )}
            {canManage && (
              <button onClick={() => setMode(mode === "delete" ? null : "delete")} style={{ ...smallButton, color: colors.rust }}><Trash2 size={13} /> Delete</button>
            )}
            {canPromote && (
              <button onClick={() => setMode(mode === "promote" ? null : "promote")} style={smallButton}><ShieldPlus size={13} /> Make administrator</button>
            )}
            {canDemote && (
              <button onClick={() => setMode(mode === "demote" ? null : "demote")} disabled={adminCount <= 1} style={{ ...smallButton, color: colors.rust, opacity: adminCount <= 1 ? 0.5 : 1 }}>
                <ShieldMinus size={13} /> Remove administrator access
              </button>
            )}
          </div>
          {canDemote && adminCount <= 1 && (
            <p style={{ fontSize: 13, color: colors.inkFaint, margin: "6px 0 0" }}>There must always be at least one administrator, so this can't be removed right now.</p>
          )}

          {mode === "edit" && (
            <EditForm account={a} busy={busy} onCancel={() => setMode(null)} onSave={async (f) => { if (await actions.update(a, f)) setMode(null) }} />
          )}

          {mode === "suspend" && (
            <div style={{ background: colors.goldTint, borderRadius: 12, padding: 12, marginTop: 10, fontSize: 13, color: colors.ink, lineHeight: 1.5 }}>
              Suspend <strong>{nameOf(a)}</strong>? They are signed out and cannot log in, and see no patients, until you reactivate them. Their notes, check-ins and shifts stay exactly as they are.
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button onClick={async () => { if (await actions.suspend(a, true)) setMode(null) }} disabled={busy} style={{ ...dangerButton, background: colors.gold }}>Yes, suspend</button>
                <button onClick={() => setMode(null)} style={smallButton}>Keep active</button>
              </div>
            </div>
          )}

          {mode === "promote" && (
            <div style={{ background: colors.goldTint, borderRadius: 12, padding: 12, marginTop: 10, fontSize: 13, color: colors.ink, lineHeight: 1.5 }}>
              Make <strong>{nameOf(a)}</strong> a full administrator? They'll be able to approve or suspend any account, edit or delete any patient, and see the complete audit trail — everything you can do. They'll keep logging in with their Company ID, and will be emailed a sign-in code from now on, the same as you are.
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button onClick={async () => { if (await actions.promote(a)) setMode(null) }} disabled={busy} style={{ ...primaryButton, opacity: busy ? 0.6 : 1 }}>{busy ? "Saving..." : "Yes, make them an administrator"}</button>
                <button onClick={() => setMode(null)} style={smallButton}>Cancel</button>
              </div>
            </div>
          )}

          {mode === "demote" && (
            <div style={{ background: colors.rustTint, borderRadius: 12, padding: 12, marginTop: 10, fontSize: 13, color: colors.ink, lineHeight: 1.5 }}>
              Remove <strong>{nameOf(a)}</strong>'s administrator access? They go back to being a caregiver, keeping their Company ID, and can be assigned patients like any other caregiver.
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button onClick={async () => { if (await actions.demote(a)) setMode(null) }} disabled={busy} style={dangerButton}>{busy ? "Saving..." : "Yes, remove access"}</button>
                <button onClick={() => setMode(null)} style={smallButton}>Cancel</button>
              </div>
            </div>
          )}

          {mode === "delete" && (
            <div style={{ background: colors.rustTint, borderRadius: 12, padding: 12, marginTop: 10, fontSize: 13, color: colors.ink, lineHeight: 1.5 }}>
              <strong>{pending ? "Reject and delete" : "Delete"} {nameOf(a)} for good?</strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                <li>{patientNames.length ? `They lose access to ${patientNames.length} ${patientNames.length === 1 ? "patient" : "patients"} (${patientNames.join(", ")}).` : "They have no patients assigned."}</li>
                {shiftList.length > 0 && <li>Their {shiftList.length} {shiftList.length === 1 ? "shift is" : "shifts are"} deleted.</li>}
                <li>Notes and check-ins they wrote stay with the patient.</li>
                <li>This cannot be undone. {a.approved ? "To pause someone instead, use Suspend." : ""}</li>
              </ul>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button onClick={async () => { if (await actions.remove(a)) setMode(null) }} disabled={busy} style={dangerButton}>{busy ? "Deleting..." : "Yes, delete"}</button>
                <button onClick={() => setMode(null)} style={smallButton}>Keep</button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

export default function AccountsTab({ accounts, assignments, patients, shifts, userId, onChanged, onMessage, requests = [] }) {
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("all") // all | waiting | active | suspended | look
  const [role, setRole] = useState("all")
  const [openId, setOpenId] = useState(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [selected, setSelected] = useState([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)

  const now = Date.now()
  const patientName = (id) => patients.find((p) => p.id === id)?.full_name
  const patientsOf = (uid) => assignments.filter((x) => x.user_id === uid).map((x) => patientName(x.patient_id)).filter(Boolean)
  const shiftsOf = (uid) => shifts.filter((s) => s.caregiver_id === uid)

  async function run(fn, okText) {
    setBusy(true)
    setMessage(null)
    const { error, text } = await fn()
    setBusy(false)
    if (error) { setMessage({ type: "error", text: error }); return false }
    setMessage({ type: "ok", text: text || okText })
    await onChanged()
    return true
  }

  const rpc = (name, args) => async () => {
    const { error } = await supabase.rpc(name, args)
    return { error: error?.message }
  }

  const actions = {
    async approve(a) {
      return run(async () => {
        const { error } = await supabase.rpc("admin_approve_account", { p_user: a.user_id })
        if (error) return { error: error.message }
        const mail = await supabase.functions.invoke("send-mail", { body: { type: "approved", userId: a.user_id } })
        const emailed = !mail.error && mail.data?.sent === 1
        return { text: `${nameOf(a)} was approved${emailed ? " and has been emailed" : ""}. Assign them a patient in the Patients tab.` }
      })
    },
    remove: (a) => run(rpc("admin_delete_account", { p_user: a.user_id }), `${nameOf(a)} was deleted.`),
    suspend: (a, on) => run(rpc("admin_set_suspended", { p_user: a.user_id, p_suspend: on }), on ? `${nameOf(a)} was suspended.` : `${nameOf(a)} was reactivated and can log in again.`),
    update: (a, f) => run(async () => {
      const r = await supabase.rpc("admin_update_account", {
        p_user: a.user_id, p_first: f.first, p_last: f.last, p_job_title: f.job, p_phone: f.phone, p_organisation: f.org, p_company_id: f.cid,
      })
      if (r.error) return { error: r.error.message }
      if (a.role !== "relative" && (f.bMonth || "") + "/" + (f.bDay || "") !== (a.birthday_month || "") + "/" + (a.birthday_day || "")) {
        const has = f.bMonth && f.bDay
        const b = await supabase.rpc("admin_set_birthday", { p_user: a.user_id, p_month: has ? Number(f.bMonth) : null, p_day: has ? Number(f.bDay) : null })
        if (b.error) return { error: "The details were saved, but the birthday was not. Choose both a month and a day, or clear both." }
      }
      return {}
    }, `${nameOf(a)}'s details were saved.`),
    resendVerification: (a) => run(async () => {
      const { data, error } = await supabase.functions.invoke("admin-auth-mail", { body: { action: "resend_verification", userId: a.user_id } })
      if (error) return { error: await functionError(error) }
      return { text: data?.sent ? `A new verification email was sent to ${a.email}.` : "The email could not be sent." }
    }),
    resetPassword: (a) => run(async () => {
      const { data, error } = await supabase.functions.invoke("admin-auth-mail", { body: { action: "reset_password", userId: a.user_id } })
      if (error) return { error: await functionError(error) }
      return { text: data?.sent ? `A password-reset email was sent to ${a.email}.` : "The email could not be sent." }
    }),
    clearPhoto: (a) => run(rpc("admin_clear_avatar", { p_user: a.user_id }), `${nameOf(a)}'s photo was removed.`),
    promote: (a) => run(rpc("admin_promote_to_admin", { p_user: a.user_id }), `${nameOf(a)} is now an administrator.`),
    demote: (a) => run(rpc("admin_demote_admin", { p_user: a.user_id }), `${nameOf(a)}'s administrator access was removed.`),
  }

  async function approveSelected() {
    const list = accounts.filter((a) => selected.includes(a.user_id) && isPending(a))
    setBusy(true)
    setMessage(null)
    let done = 0
    let failed = null
    for (const a of list) {
      const { error } = await supabase.rpc("admin_approve_account", { p_user: a.user_id })
      if (error) { failed = `${nameOf(a)}: ${error.message}`; break }
      done++
      await supabase.functions.invoke("send-mail", { body: { type: "approved", userId: a.user_id } })
    }
    setBusy(false)
    setSelected([])
    setMessage(failed ? { type: "error", text: `${done} approved, then it stopped. ${failed}` } : { type: "ok", text: `${done} ${done === 1 ? "account was" : "accounts were"} approved and emailed.` })
    await onChanged()
  }

  const counts = {
    all: accounts.length,
    waiting: accounts.filter(isPending).length,
    active: accounts.filter(isActive).length,
    suspended: accounts.filter((a) => a.suspended).length,
    look: accounts.filter((a) => attentionReasons(a, now).length > 0).length,
  }
  const q = query.trim().toLowerCase()
  const shown = accounts
    .filter((a) =>
      (status === "all" || (status === "waiting" && isPending(a)) || (status === "active" && isActive(a)) ||
        (status === "suspended" && a.suspended) || (status === "look" && attentionReasons(a, now).length > 0)) &&
      (role === "all" || a.role === role) &&
      (!q || [nameOf(a), a.email, a.company_id].filter(Boolean).join(" ").toLowerCase().includes(q)))
    .sort((x, y) => Number(isPending(y)) - Number(isPending(x)))
  const waitingShown = shown.filter(isPending)
  const adminCount = accounts.filter((a) => a.role === "admin").length
  const chips = [["all", "All"], ["waiting", "Waiting"], ["active", "Active"], ["suspended", "Suspended"], ["look", "Needs a look"]]
  const showMore = moreOpen || status === "suspended" || status === "look" || role !== "all"

  return (
    <>
      <Message message={message} />
      <ChangeRequests requests={requests} accounts={accounts} onChanged={onChanged} />

      <div style={{ position: "relative", marginBottom: 10 }}>
        <Search size={14} color={colors.inkFaint} style={{ position: "absolute", left: 12, top: 12 }} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, email or Company ID" style={{ ...inputStyle, paddingLeft: 34, borderRadius: 999 }} />
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: showMore ? 8 : 12 }}>
        {chips.slice(0, 3).map(([key, label]) => <button key={key} onClick={() => setStatus(key)} style={pill(status === key)}>{label} {counts[key]}</button>)}
        <button onClick={() => setMoreOpen((o) => !o)} aria-expanded={showMore} style={pill(showMore && (status === "suspended" || status === "look" || role !== "all"))}>More filters</button>
      </div>
      {showMore && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          {chips.slice(3).map(([key, label]) => <button key={key} onClick={() => setStatus(key)} style={pill(status === key)}>{label} {counts[key]}</button>)}
          <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Show one kind of account" style={{ ...inputStyle, width: "auto", padding: "6px 10px", fontSize: 13 }}>
            <option value="all">All roles</option>
            <option value="caregiver">Caregivers</option>
            <option value="relative">Family proxies</option>
            <option value="admin">Administrators</option>
          </select>
        </div>
      )}

      {waitingShown.length > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: colors.goldTint, borderRadius: 12, padding: "10px 14px", marginBottom: 12 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: colors.ink }}>
            {waitingShown.length} {waitingShown.length === 1 ? "account is" : "accounts are"} waiting for your approval
          </span>
          <button onClick={() => setSelected(selected.length === waitingShown.length ? [] : waitingShown.map((a) => a.user_id))} style={smallButton}>
            {selected.length === waitingShown.length ? "Clear selection" : "Select all waiting"}
          </button>
          {selected.length > 0 && (
            <button onClick={approveSelected} disabled={busy} style={{ ...primaryButton, opacity: busy ? 0.6 : 1 }}><Check size={13} /> Approve selected ({selected.length})</button>
          )}
        </div>
      )}

      {shown.length === 0 ? (
        <p style={{ fontSize: 13.5, color: colors.inkFaint }}>No accounts match.</p>
      ) : (
        shown.map((a) => (
          <AccountCard
            key={a.user_id} a={a} isMe={a.user_id === userId}
            open={openId === a.user_id} onToggle={(v) => setOpenId(v ? a.user_id : null)}
            selected={selected.includes(a.user_id)}
            onSelect={() => setSelected((s) => (s.includes(a.user_id) ? s.filter((x) => x !== a.user_id) : [...s, a.user_id]))}
            busy={busy} actions={actions} patientNames={patientsOf(a.user_id)} shiftList={shiftsOf(a.user_id)} adminCount={adminCount} onMessage={onMessage}
          />
        ))
      )}
    </>
  )
}

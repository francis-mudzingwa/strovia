import { useState, useEffect, useCallback } from "react"
import { Users, ClipboardList, ShieldCheck, CalendarClock, HeartHandshake } from "lucide-react"
import { supabase } from "./supabaseClient.js"
import { ShiftsAdmin } from "./Shifts.jsx"
import { VisitsAdmin } from "./Visits.jsx"
import AccountsTab, { isPending } from "./manage/AccountsTab.jsx"
import PatientsTab from "./manage/PatientsTab.jsx"
import AuditTab, { failedSignInAlerts } from "./manage/AuditTab.jsx"
import { colors, Count, nameOf } from "./manage/ui.jsx"
import { registerAvatars } from "./Avatar.jsx"

// The administrator's page: people, patients and their care teams, shifts, and the audit trail.
export default function ManageAccounts({ userId, patients, onPatientsChanged, onPendingChanged, onPatientAdded, onMessage }) {
  const [tab, setTab] = useState("accounts")
  const [accounts, setAccounts] = useState([])
  const [assignments, setAssignments] = useState([])
  const [invitations, setInvitations] = useState([])
  const [activity, setActivity] = useState([])
  const [shifts, setShifts] = useState([])
  const [visits, setVisits] = useState([])
  const [allPatients, setAllPatients] = useState([]) // includes archived ones
  const [requests, setRequests] = useState([]) // people asking to change their details
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    const [acc, asg, inv, act, shf, vis, pts, req] = await Promise.all([
      supabase.rpc("admin_list_accounts"),
      supabase.from("patient_assignments").select("patient_id, user_id, is_primary"),
      supabase.from("join_invitations").select("id, token, patient_id, invitee_name, invitee_email, relationship, status, created_at").order("created_at", { ascending: false }),
      supabase.rpc("admin_activity_feed", { p_limit: 1000 }),
      supabase.from("shifts").select("*"),
      supabase.from("visits").select("*"),
      supabase.from("patients").select("id, full_name, profile, archived_at").order("full_name"),
      supabase.from("profile_change_requests").select("*").eq("status", "pending").order("created_at"),
    ])
    const pendingRequests = req.data || []
    setRequests(pendingRequests)
    setError(acc.error ? acc.error.message : null)
    const list = acc.data || []
    registerAvatars(list)
    setAccounts(list)
    onPendingChanged?.(list.filter(isPending).length + pendingRequests.length)
    setAssignments(asg.data || [])
    setInvitations(inv.data || [])
    setActivity(act.data || [])
    setShifts(shf.data || [])
    setVisits(vis.data || [])
    setAllPatients(pts.data || [])
    setLoading(false)
  }, [onPendingChanged])

  useEffect(() => { reload() }, [reload])

  const me = accounts.find((a) => a.user_id === userId)
  const printedBy = me ? nameOf(me) : "an administrator"

  // Numbers for the tab bar: the things that need the administrator's attention.
  const roleOf = (uid) => accounts.find((a) => a.user_id === uid)?.role
  const activePatients = allPatients.filter((p) => !p.archived_at)
  const caregiverCount = (pid) => assignments.filter((x) => x.patient_id === pid && roleOf(x.user_id) === "caregiver").length
  const badges = {
    accounts: accounts.filter(isPending).length + requests.length,
    patients: activePatients.filter((p) => caregiverCount(p.id) === 0).length,
    shifts: activePatients.filter((p) => caregiverCount(p.id) > 0 && !shifts.some((s) => s.patient_id === p.id)).length,
    activity: failedSignInAlerts(activity).length,
  }
  const hints = {
    accounts: "accounts waiting for approval or asking to change their details",
    patients: "patients with no caregiver",
    shifts: "patients with a caregiver but no shifts",
    activity: "accounts with repeated failed sign-ins",
  }

  const tabs = [
    { key: "accounts", label: "Accounts", icon: Users },
    { key: "patients", label: "Patients", icon: ClipboardList },
    { key: "shifts", label: "Shifts", icon: CalendarClock },
    { key: "visits", label: "Visits", icon: HeartHandshake },
    { key: "activity", label: "Audit", icon: ShieldCheck },
  ]

  return (
    <div>
      <h1 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 24, fontWeight: 600, color: colors.ink, margin: "0 0 10px" }}>Manage</h1>

      <div role="tablist" aria-label="Manage" style={{ display: "flex", borderBottom: `1.5px solid ${colors.hairline}`, marginBottom: 16 }}>
        {tabs.map((t) => {
          const on = tab === t.key
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={on}
              onClick={() => setTab(t.key)}
              title={badges[t.key] ? `${badges[t.key]} ${hints[t.key]}` : undefined}
              style={{ flex: 1, minWidth: 0, padding: "11px 0 10px", border: "none", background: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", color: on ? colors.sageDeep : colors.inkSoft, borderBottom: `3px solid ${on ? colors.sage : "transparent"}`, marginBottom: -1.5 }}
            >
              <span style={{ position: "relative" }}>
                {t.label}
                {badges[t.key] > 0 && <span aria-label={`${badges[t.key]} ${hints[t.key]}`} style={{ position: "absolute", top: -3, right: -9, width: 7, height: 7, borderRadius: 999, background: colors.rust }} />}
              </span>
            </button>
          )
        })}
      </div>

      {error && <p style={{ color: colors.rust, fontSize: 13 }}>{error}</p>}
      {loading ? (
        <p style={{ fontSize: 13.5, color: colors.inkFaint }}>Loading...</p>
      ) : tab === "accounts" ? (
        <AccountsTab accounts={accounts} assignments={assignments} patients={allPatients} shifts={shifts} userId={userId} onChanged={reload} onMessage={onMessage} requests={requests} />
      ) : tab === "patients" ? (
        <PatientsTab
          userId={userId} patients={allPatients} accounts={accounts} assignments={assignments} invitations={invitations} shifts={shifts}
          onChanged={async () => { await onPatientsChanged(); await reload() }} onPatientAdded={onPatientAdded}
        />
      ) : tab === "shifts" ? (
        <ShiftsAdmin userId={userId} accounts={accounts} patients={patients} assignments={assignments} shifts={shifts} printedBy={printedBy} onChanged={reload} onGoTo={setTab} />
      ) : tab === "visits" ? (
        <VisitsAdmin userId={userId} patients={patients} visits={visits} onChanged={reload} />

      ) : (
        <AuditTab activity={activity} onRefresh={reload} printedBy={printedBy} />
      )}
    </div>
  )
}

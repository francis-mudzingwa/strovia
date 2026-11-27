import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { ChevronLeft, ChevronDown, Plus, Send, Lock, X, AlertTriangle, ExternalLink } from "lucide-react"
import { supabase } from "./supabaseClient.js"
import { Card, colors, fmtTime } from "./care/ui.jsx"
import { Avatar, registerAvatars } from "./Avatar.jsx"

// Messages between caregivers and administrators. Family members and health proxies never see this tab, and the database
// refuses to give them any message. Three kinds of conversation: everyone on staff, one per patient (the caregivers on
// that patient plus the administrators), and private one-to-one messages.

const AMBER = "#6B4D0E"
const initialsOf = (name) => (String(name || "").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2) || "?").toUpperCase()
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const dayLabel = (d, now = new Date()) => {
  const y = new Date(now); y.setDate(y.getDate() - 1)
  return sameDay(d, now) ? "Today" : sameDay(d, y) ? "Yesterday" : d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })
}
const shortWhen = (iso, now = new Date()) => {
  const d = new Date(iso)
  if (sameDay(d, now)) return fmtTime(d)
  const week = (now - d) / 86400000 < 6
  return week ? d.toLocaleDateString(undefined, { weekday: "short" }) : d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

// The conversations and the staff list, kept fresh. The badge on the Messages tab reads `unread` from here.
export function useMessaging(enabled) {
  const [threads, setThreads] = useState([])
  const [directory, setDirectory] = useState([])
  const [loaded, setLoaded] = useState(false)
  const reload = useCallback(async () => {
    if (!enabled) return
    const [t, d] = await Promise.all([supabase.rpc("my_threads"), supabase.rpc("staff_directory")])
    if (!t.error && t.data) setThreads(t.data)
    if (!d.error && d.data) { setDirectory(d.data); registerAvatars(d.data) }
    setLoaded(true)
  }, [enabled])

  useEffect(() => {
    if (!enabled) return undefined
    reload()
    const visibleReload = () => { if (document.visibilityState === "visible") reload() }
    const timer = setInterval(visibleReload, 30000)
    document.addEventListener("visibilitychange", visibleReload)
    let channel = null
    try {
      channel = supabase.channel("staff-messages").on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => reload()).subscribe()
    } catch { /* live updates are a bonus: the 30 second refresh still works */ }
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", visibleReload)
      if (channel) try { supabase.removeChannel(channel) } catch { /* nothing to clean up */ }
    }
  }, [enabled, reload])

  const unread = threads.reduce((n, t) => n + (t.unread || 0), 0)
  return { threads, directory, loaded, reload, unread }
}

export default function MessagesView({ userId, patients, messaging, onOpenPatient, wide, startWith, onStarted }) {
  const { threads, directory, loaded, reload } = messaging
  const [openId, setOpenId] = useState(null)
  const [composing, setComposing] = useState(false)
  const [showEmpty, setShowEmpty] = useState(false)

  const person = useMemo(() => {
    const m = new Map(directory.map((d) => [d.user_id, d]))
    return (id) => m.get(id)
  }, [directory])
  const patientName = (id) => patients.find((p) => p.id === id)?.full_name || null
  const titleOf = (t) => (t.kind === "all" ? "All staff" : t.kind === "patient" ? (patientName(t.patient_id) ? `${patientName(t.patient_id)}'s team` : "Patient team") : person(t.other_user)?.name || "Team member")

  const open = threads.find((t) => t.id === openId)

  // A Message button elsewhere in the app asked to talk to one person: open (or create) the private conversation.
  useEffect(() => {
    if (!startWith || !loaded) return
    let cancelled = false
    ;(async () => {
      const r = await supabase.rpc("start_direct", { p_other: startWith })
      if (cancelled) return
      if (onStarted) onStarted()
      if (!r.error && r.data) { await reload(); setOpenId(r.data) }
    })()
    return () => { cancelled = true }
  }, [startWith, loaded])

  if (open) {
    return <ThreadView thread={open} title={titleOf(open)} userId={userId} person={person} directory={directory} patientName={patientName(open.patient_id)} wide={wide}
      onBack={() => { setOpenId(null); reload() }} onChanged={reload} onOpenPatient={onOpenPatient} />
  }

  const byRecent = (a, b) => (b.last_at ? new Date(b.last_at).getTime() : 0) - (a.last_at ? new Date(a.last_at).getTime() : 0)
  const everyone = threads.filter((t) => t.kind === "all")
  const teams = threads.filter((t) => t.kind === "patient").sort((a, b) => byRecent(a, b) || titleOf(a).localeCompare(titleOf(b)))
  const activeTeams = teams.filter((t) => t.last_at)
  const quietTeams = teams.filter((t) => !t.last_at)
  const direct = threads.filter((t) => t.kind === "direct").sort(byRecent)

  const section = (label) => <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 0.5, color: colors.inkFaint, textTransform: "uppercase", margin: "16px 4px 8px" }}>{label}</div>

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
        <h1 style={{ fontFamily: "Fraunces, serif", fontSize: 25, fontWeight: 600, color: colors.ink, margin: 0 }}>Messages</h1>
        <button onClick={() => setComposing(true)} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "none", background: colors.sage, color: "#fff", borderRadius: 11, padding: "10px 14px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
          <Plus size={16} /> New message
        </button>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: colors.tealTint, color: "#2F5A62", borderRadius: 12, padding: "9px 12px", fontSize: 13, lineHeight: 1.45 }}>
        <Lock size={14} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>Only caregivers and administrators can see Messages. Family members cannot.</span>
      </div>

      {!loaded && <p style={{ fontSize: 14, color: colors.inkFaint, marginTop: 16 }}>Loading...</p>}

      {everyone.length > 0 && section("Everyone")}
      {everyone.map((t) => <ThreadRow key={t.id} t={t} title={titleOf(t)} userId={userId} person={person} onOpen={() => setOpenId(t.id)} />)}

      {teams.length > 0 && section("Patient teams")}
      {activeTeams.map((t) => <ThreadRow key={t.id} t={t} title={titleOf(t)} userId={userId} person={person} patientName={patientName(t.patient_id)} onOpen={() => setOpenId(t.id)} />)}
      {quietTeams.length > 0 && (
        <>
          <button onClick={() => setShowEmpty((v) => !v)} aria-expanded={showEmpty} style={{ display: "flex", alignItems: "center", gap: 6, border: "none", background: "none", cursor: "pointer", color: colors.inkSoft, fontSize: 13.5, fontWeight: 600, padding: "6px 4px" }}>
            <ChevronDown size={15} style={{ transform: showEmpty ? "rotate(180deg)" : "none" }} />
            {activeTeams.length ? `${quietTeams.length} more patient ${quietTeams.length === 1 ? "team" : "teams"} with no messages yet` : `${quietTeams.length} patient ${quietTeams.length === 1 ? "team" : "teams"}, no messages yet`}
          </button>
          {showEmpty && quietTeams.sort((a, b) => titleOf(a).localeCompare(titleOf(b))).map((t) => <ThreadRow key={t.id} t={t} title={titleOf(t)} userId={userId} person={person} patientName={patientName(t.patient_id)} onOpen={() => setOpenId(t.id)} />)}
        </>
      )}

      {section("Direct")}
      {direct.map((t) => <ThreadRow key={t.id} t={t} title={titleOf(t)} userId={userId} person={person} onOpen={() => setOpenId(t.id)} />)}
      {loaded && direct.length === 0 && <p style={{ fontSize: 13.5, color: colors.inkFaint, margin: "0 4px" }}>No private conversations yet. Tap New message, then One person.</p>}

      {composing && (
        <Compose userId={userId} threads={threads} directory={directory} titleOf={titleOf}
          onClose={() => setComposing(false)} onSent={async (id) => { setComposing(false); await reload(); setOpenId(id) }} />
      )}
    </div>
  )
}

function ThreadRow({ t, title, userId, person, patientName, onOpen }) {
  const hasUnread = t.unread > 0
  const urgent = t.unread_urgent
  const sender = t.last_sender === userId ? "You" : person(t.last_sender)?.name?.split(" ")[0]
  const preview = t.last_body ? `${t.kind === "direct" && t.last_sender !== userId ? "" : sender ? `${sender}: ` : ""}${t.last_body}` : "No messages yet"
  return (
    <button onClick={onOpen} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", font: "inherit", cursor: "pointer", background: "#fff", border: urgent ? `2px solid ${colors.rust}` : "none", borderRadius: 16, padding: urgent ? "10px 12px" : "12px 14px", marginBottom: 9, boxShadow: "0 1px 3px rgba(32,38,31,0.06), 0 4px 12px rgba(32,38,31,0.04)" }}>
      {t.kind === "direct" ? <Avatar userId={t.other_user} name={title} size={44} fontSize={15} />
        : t.kind === "all" ? <Avatar name="All" size={44} fontSize={14} tone={[colors.sageDeep, "#fff"]} />
        : <Avatar name={patientName || title} size={44} fontSize={14} tone={[colors.goldTint, AMBER]} />}
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", fontSize: 15, fontWeight: hasUnread ? 800 : 700, color: colors.ink }}>{title}</span>
        <span style={{ display: "block", fontSize: 13.5, color: hasUnread ? colors.ink : colors.inkSoft, fontWeight: hasUnread ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{preview}</span>
      </span>
      <span style={{ textAlign: "right", flexShrink: 0, fontSize: 12.5, color: colors.inkFaint }}>
        {t.last_at && <span style={{ display: "block" }}>{shortWhen(t.last_at)}</span>}
        {hasUnread && <span aria-label={`${t.unread} unread`} style={{ display: "inline-block", minWidth: 20, height: 20, lineHeight: "20px", padding: "0 6px", boxSizing: "border-box", borderRadius: 999, background: colors.rust, color: "#fff", fontSize: 12, fontWeight: 700, textAlign: "center", marginTop: 4 }}>{t.unread}</span>}
      </span>
    </button>
  )
}

function ThreadView({ thread, title, userId, person, directory, patientName, wide, onBack, onChanged, onOpenPatient }) {
  const [messages, setMessages] = useState(null)
  const [reads, setReads] = useState([])
  const [text, setText] = useState("")
  const [urgent, setUrgent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const bottom = useRef(null)
  const markedAt = useRef(null)
  const id = thread.id

  const load = useCallback(async () => {
    const [m, r] = await Promise.all([
      supabase.from("messages").select("id, sender_id, body, urgent, created_at").eq("thread_id", id).order("created_at", { ascending: false }).limit(200),
      supabase.from("message_reads").select("user_id, last_read_at").eq("thread_id", id),
    ])
    if (!m.error && m.data) setMessages([...m.data].reverse())
    if (!r.error && r.data) setReads(r.data)
  }, [id])

  useEffect(() => {
    load()
    const timer = setInterval(() => { if (document.visibilityState === "visible") load() }, 8000)
    let channel = null
    try {
      channel = supabase.channel(`thread-${id}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `thread_id=eq.${id}` }, () => load()).subscribe()
    } catch { /* the 8 second refresh still works */ }
    return () => { clearInterval(timer); if (channel) try { supabase.removeChannel(channel) } catch { /* nothing to clean up */ } }
  }, [id, load])

  // Opening a conversation, or a new message arriving while it is open, counts as reading it.
  useEffect(() => {
    if (!messages || !messages.length) return
    const latest = messages[messages.length - 1]
    if (latest.sender_id === userId || markedAt.current === latest.created_at) return
    markedAt.current = latest.created_at
    supabase.rpc("mark_thread_read", { p_thread: id }).then(() => onChanged())
  }, [messages, id, userId, onChanged])

  useEffect(() => { if (bottom.current) bottom.current.scrollIntoView({ block: "end" }) }, [messages && messages.length])

  async function send() {
    const body = text.trim()
    if (!body || busy) return
    setBusy(true)
    setError(null)
    const { data, error: err } = await supabase.rpc("send_message", { p_thread: id, p_body: body, p_urgent: urgent })
    setBusy(false)
    if (err) { setError("Your message could not be sent. Please try again."); return }
    setText("")
    setUrgent(false)
    if (data) setMessages((list) => [...(list || []), { id: data.id, sender_id: data.sender_id, body: data.body, urgent: data.urgent, created_at: data.created_at }])
    onChanged()
  }

  const nameOf = (uid) => (uid === userId ? "You" : person(uid)?.name || "Former team member")
  const now = new Date()
  const members = thread.kind === "all" ? "Every caregiver and administrator" : thread.kind === "patient" ? "Caregivers and administrators on this patient" : (person(thread.other_user)?.role === "admin" ? "Administrator" : "Caregiver")

  // Who has seen my most recent message.
  const mine = messages ? [...messages].reverse().find((m) => m.sender_id === userId) : null
  const seenBy = mine ? reads.filter((r) => r.user_id !== userId && new Date(r.last_read_at) >= new Date(mine.created_at)).map((r) => person(r.user_id)?.name?.split(" ")[0]).filter(Boolean) : []
  const seenText = !mine ? null : seenBy.length === 0 ? "Not seen yet" : seenBy.length <= 3 ? `Seen by ${seenBy.join(", ")}` : `Seen by ${seenBy.slice(0, 2).join(", ")} and ${seenBy.length - 2} others`

  return (
    <div style={{ display: "flex", flexDirection: "column", height: wide ? "calc(100vh - 100px)" : "calc(100dvh - 176px)", minHeight: 420 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 10, borderBottom: `1px solid ${colors.hairline}` }}>
        <button onClick={onBack} aria-label="Back to Messages" style={{ border: "none", background: "none", cursor: "pointer", padding: 4, color: colors.inkSoft, display: "flex" }}><ChevronLeft size={24} /></button>
        {thread.kind === "direct" ? <Avatar userId={thread.other_user} name={title} size={38} fontSize={14} />
          : thread.kind === "all" ? <Avatar name="All" size={38} fontSize={13} tone={[colors.sageDeep, "#fff"]} />
          : <Avatar name={patientName || title} size={38} fontSize={13} tone={[colors.goldTint, AMBER]} />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: "Fraunces, serif", fontSize: 18, fontWeight: 600, color: colors.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
          <div style={{ fontSize: 12.5, color: colors.inkFaint }}>{members}</div>
        </div>
        {thread.kind === "patient" && thread.patient_id && (
          <button onClick={() => onOpenPatient(thread.patient_id)} style={{ display: "inline-flex", alignItems: "center", gap: 5, border: `1px solid ${colors.hairline}`, background: "#fff", borderRadius: 10, padding: "7px 10px", fontSize: 12.5, fontWeight: 700, color: colors.sageDeep, cursor: "pointer", flexShrink: 0 }}>
            <ExternalLink size={13} /> Patient
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "12px 2px", display: "flex", flexDirection: "column", gap: 4 }}>
        {messages === null && <p style={{ fontSize: 14, color: colors.inkFaint }}>Loading...</p>}
        {messages && messages.length === 0 && <p style={{ fontSize: 14, color: colors.inkSoft, textAlign: "center", marginTop: 30, lineHeight: 1.5 }}>No messages yet.<br />Write the first one below.</p>}
        {messages && messages.map((m, i) => {
          const d = new Date(m.created_at)
          const prev = messages[i - 1]
          const newDay = !prev || !sameDay(new Date(prev.created_at), d)
          const first = newDay || prev.sender_id !== m.sender_id || (d - new Date(prev.created_at)) > 5 * 60000
          const me = m.sender_id === userId
          return (
            <div key={m.id}>
              {newDay && <div style={{ textAlign: "center", fontSize: 12.5, color: colors.inkFaint, margin: "10px 0 6px" }}>{dayLabel(d, now)}</div>}
              <div style={{ display: "flex", flexDirection: me ? "row-reverse" : "row", alignItems: "flex-end", gap: 7, marginTop: first ? 8 : 0 }}>
                {!me && (first ? <Avatar userId={m.sender_id} name={nameOf(m.sender_id)} size={30} fontSize={12} /> : <span style={{ width: 30, flexShrink: 0 }} />)}
                <div style={{ maxWidth: "80%", background: m.urgent ? colors.rustTint : me ? colors.sageDeep : "#fff", color: me && !m.urgent ? "#fff" : colors.ink, border: m.urgent ? `2px solid ${colors.rust}` : "none", borderRadius: me ? "16px 16px 4px 16px" : "16px 16px 16px 4px", padding: "8px 12px", boxShadow: "0 1px 2px rgba(32,38,31,0.07)", fontSize: 14.5, lineHeight: 1.45, wordBreak: "break-word", whiteSpace: "pre-wrap" }}>
                  {m.urgent && <span style={{ display: "inline-block", background: colors.rust, color: "#fff", fontSize: 11, fontWeight: 800, letterSpacing: 0.4, padding: "1px 8px", borderRadius: 999, marginBottom: 4 }}>URGENT</span>}
                  {!me && first && <div style={{ fontSize: 12, fontWeight: 700, color: m.urgent ? colors.rust : colors.teal, marginBottom: 2 }}>{nameOf(m.sender_id)}</div>}
                  <div>{m.body}</div>
                  <div style={{ fontSize: 11.5, marginTop: 3, textAlign: me ? "right" : "left", color: me && !m.urgent ? "#C9D9CF" : colors.inkFaint }}>{fmtTime(d)}</div>
                </div>
              </div>
              {mine && m.id === mine.id && seenText && <div style={{ textAlign: "right", fontSize: 12, color: colors.inkFaint, marginTop: 3 }}>{seenText}</div>}
            </div>
          )
        })}
        <div ref={bottom} />
      </div>

      {error && <p style={{ color: colors.rust, fontSize: 13, margin: "0 0 6px" }}>{error}</p>}
      <div style={{ borderTop: `1px solid ${colors.hairline}`, paddingTop: 10 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={2000} placeholder="Write a message..." aria-label="Write a message"
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send() } }}
            style={{ flex: 1, resize: "none", maxHeight: 120, minHeight: 42, padding: "10px 14px", borderRadius: 21, border: `1px solid ${colors.hairline}`, fontSize: 15, fontFamily: "inherit", color: colors.ink, background: "#fff", boxSizing: "border-box", lineHeight: 1.35 }}
            ref={(el) => { if (el) { el.style.height = "42px"; el.style.height = Math.min(el.scrollHeight, 120) + "px" } }} />
          <button onClick={send} disabled={busy || !text.trim()} aria-label="Send message" style={{ width: 42, height: 42, borderRadius: 999, border: "none", background: colors.sage, color: "#fff", cursor: busy || !text.trim() ? "default" : "pointer", opacity: busy || !text.trim() ? 0.5 : 1, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Send size={18} /></button>
        </div>
        <button onClick={() => setUrgent((u) => !u)} aria-pressed={urgent} style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8, border: `1.5px solid ${urgent ? colors.rust : colors.hairline}`, background: urgent ? colors.rustTint : "#fff", color: urgent ? colors.rust : colors.inkSoft, borderRadius: 999, padding: "5px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          <AlertTriangle size={13} /> {urgent ? "Urgent: also sends a phone alert" : "Mark as urgent"}
        </button>
      </div>
    </div>
  )
}

function Compose({ userId, threads, directory, titleOf, onClose, onSent }) {
  const [to, setTo] = useState("all")
  const [teamId, setTeamId] = useState("")
  const [personId, setPersonId] = useState("")
  const [text, setText] = useState("")
  const [urgent, setUrgent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const teams = threads.filter((t) => t.kind === "patient").sort((a, b) => titleOf(a).localeCompare(titleOf(b)))
  const people = directory.filter((d) => d.user_id !== userId).sort((a, b) => a.name.localeCompare(b.name))
  const ready = text.trim() && (to === "all" || (to === "team" && teamId) || (to === "person" && personId))

  async function send() {
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      let tid
      if (to === "all") tid = threads.find((t) => t.kind === "all")?.id
      else if (to === "team") tid = teamId
      else {
        const r = await supabase.rpc("start_direct", { p_other: personId })
        if (r.error) throw r.error
        tid = r.data
      }
      if (!tid) throw new Error("no conversation")
      const { error: err } = await supabase.rpc("send_message", { p_thread: tid, p_body: text.trim(), p_urgent: urgent })
      if (err) throw err
      await onSent(tid)
    } catch {
      setError("Your message could not be sent. Please try again.")
      setBusy(false)
    }
  }

  const chip = (key, label) => (
    <button key={key} onClick={() => setTo(key)} aria-pressed={to === key} style={{ border: `1.5px solid ${to === key ? colors.sage : colors.hairline}`, background: to === key ? colors.sageTint : "#fff", color: to === key ? colors.sageDeep : colors.inkSoft, borderRadius: 999, padding: "8px 14px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>{label}</button>
  )
  const select = { width: "100%", padding: "11px 12px", borderRadius: 10, border: `1px solid ${colors.hairline}`, fontSize: 15, background: "#fff", color: colors.ink, marginTop: 10, boxSizing: "border-box" }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 40, display: "flex", alignItems: "flex-end", justifyContent: "center", background: "rgba(32,38,31,0.4)" }} onClick={onClose}>
      <div role="dialog" aria-label="New message" onClick={(e) => e.stopPropagation()} style={{ background: "#fff", width: "100%", maxWidth: 560, borderRadius: "22px 22px 0 0", padding: "18px 18px 22px", boxShadow: "0 -8px 24px rgba(32,38,31,0.18)", maxHeight: "92vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontFamily: "Fraunces, serif", fontSize: 20, fontWeight: 600, color: colors.ink }}>New message</div>
          <button onClick={onClose} aria-label="Close" style={{ border: "none", background: "none", cursor: "pointer", color: colors.inkSoft, display: "flex", padding: 4 }}><X size={20} /></button>
        </div>
        <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 0.5, color: colors.inkFaint, textTransform: "uppercase", marginBottom: 7 }}>To</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {chip("all", "All staff")}{chip("team", "A patient's team")}{chip("person", "One person")}
        </div>
        {to === "team" && (
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)} aria-label="Which patient's team" style={select}>
            <option value="">Choose a patient...</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{titleOf(t)}</option>)}
          </select>
        )}
        {to === "person" && (
          <select value={personId} onChange={(e) => setPersonId(e.target.value)} aria-label="Which person" style={select}>
            <option value="">Choose a person...</option>
            {people.map((d) => <option key={d.user_id} value={d.user_id}>{d.name} ({d.role === "admin" ? "Administrator" : "Caregiver"})</option>)}
          </select>
        )}
        <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 0.5, color: colors.inkFaint, textTransform: "uppercase", margin: "14px 0 7px" }}>Message</div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={2000} placeholder="Write your message..." aria-label="Message"
          style={{ width: "100%", padding: "11px 12px", borderRadius: 12, border: `1px solid ${colors.hairline}`, fontSize: 15, fontFamily: "inherit", color: colors.ink, boxSizing: "border-box", resize: "vertical", lineHeight: 1.4 }} />
        <button onClick={() => setUrgent((u) => !u)} aria-pressed={urgent} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", marginTop: 10, border: "none", background: urgent ? colors.rustTint : colors.bg, borderRadius: 12, padding: "10px 12px", cursor: "pointer", font: "inherit", color: colors.ink }}>
          <span style={{ width: 38, height: 22, borderRadius: 999, background: urgent ? colors.rust : colors.hairline, position: "relative", flexShrink: 0 }}>
            <span style={{ position: "absolute", top: 3, left: urgent ? 19 : 3, width: 16, height: 16, borderRadius: 999, background: "#fff", transition: "left 0.15s" }} />
          </span>
          <span style={{ fontSize: 13.5, lineHeight: 1.35 }}><strong>Urgent</strong><br />Also sends a phone alert to everyone in this conversation.</span>
        </button>
        {error && <p style={{ color: colors.rust, fontSize: 13, margin: "10px 0 0" }}>{error}</p>}
        <button onClick={send} disabled={!ready || busy} style={{ width: "100%", marginTop: 12, padding: "13px 0", borderRadius: 12, border: "none", background: colors.sage, color: "#fff", fontSize: 15, fontWeight: 700, cursor: !ready || busy ? "default" : "pointer", opacity: !ready || busy ? 0.55 : 1 }}>{busy ? "Sending..." : "Send"}</button>
        <p style={{ fontSize: 12.5, color: colors.inkFaint, margin: "10px 0 0", textAlign: "center" }}>Family members will not see this message.</p>
      </div>
    </div>
  )
}

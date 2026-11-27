import { StrictMode, useState, useEffect, useRef, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { LogoMark } from './Logo.jsx'
import UpdateBanner from './UpdateBanner.jsx'
import { Eye, EyeOff, ClipboardList, Activity, Sparkles, FileText, CalendarDays, HeartHandshake, ShieldCheck } from 'lucide-react'
import './index.css'
import App from './App.jsx'
import JoinPage from './JoinPage.jsx'
import AuthCard, { passwordStrength } from './AuthCard.jsx'
import { supabase } from './supabaseClient.js'
import { applyTextSize } from './textSize.js'
import BirthdayGate from './BirthdayGate.jsx'

const colors = { sage: "#3F6C51", sageDeep: "#2C4E3A", sageTint: "#E3EBE0", bg: "#FAF6EF", ink: "#20261F", inkSoft: "#4B5245", inkFaint: "#6B7266", hairline: "#E5DFD1", rust: "#A24632", gold: "#B98A2E", teal: "#4C7A82" }

const FEATURES = [
  { icon: FileText, color: colors.sage, title: "Follow the stroke care plan", text: "Services, fall risk, equipment, diet and recovery goals laid out in one clear plan." },
  { icon: ClipboardList, color: colors.teal, title: "Track symptoms every day", text: "Record the B.E. F.A.S.T. signs (balance, eyes, face, arms and speech) in a daily check-in, and note when anything started." },
  { icon: Activity, color: colors.gold, title: "Watch recovery progress", text: "See the recovery score and symptom trends change over time." },
  { icon: CalendarDays, color: colors.rust, title: "Track appointments", text: "Save the doctor, time, address and what to bring, with a reminder the day before." },
  { icon: Sparkles, color: colors.sage, title: "Understand what's changed, and why", text: "Get plain-language explanations behind new or worsening symptoms." },
  { icon: HeartHandshake, color: colors.teal, title: "Care that never has a gap", text: "When the caregiver is away, an invited family member steps in with the same care plan, history and notes." },
]

function AwaitingApproval({ name, onCheckAgain, onSignOut }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background: colors.bg, padding: 16 }}>
      <div style={{ background: "#fff", padding: 30, borderRadius: 18, width: 380, maxWidth: "100%", boxSizing: "border-box", textAlign: "center", boxShadow: "0 1px 3px rgba(32,38,31,0.06), 0 6px 16px rgba(32,38,31,0.05)" }}>
        <div style={{ width: 52, height: 52, borderRadius: 14, background: colors.sageTint, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
          <ShieldCheck size={26} color={colors.sageDeep} />
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: colors.ink, marginBottom: 8 }}>
          {name ? `Thank you, ${name}` : "Thank you for registering"}
        </div>
        <p style={{ fontSize: 13.5, color: colors.inkSoft, lineHeight: 1.55, margin: "0 0 18px" }}>
          Your account is waiting for approval by the administrator. Once it's approved and a patient is assigned to you, you'll see them here.
        </p>
        <button onClick={onCheckAgain} style={{ width: "100%", padding: 11, borderRadius: 9, border: "none", background: colors.sage, color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
          Check again
        </button>
        <button onClick={onSignOut} style={{ width: "100%", padding: 11, borderRadius: 9, border: `1px solid ${colors.hairline}`, background: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600, color: colors.ink }}>
          Log out
        </button>
      </div>
    </div>
  )
}

function NoAccess({ email, onSignOut }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background: colors.bg, padding: 16 }}>
      <div style={{ background: "#fff", padding: 30, borderRadius: 18, width: 380, maxWidth: "100%", boxSizing: "border-box", textAlign: "center", boxShadow: "0 1px 3px rgba(32,38,31,0.06), 0 6px 16px rgba(32,38,31,0.05)" }}>
        <div style={{ display: "flex", justifyContent: "center", margin: "0 auto 12px" }}><LogoMark size={52} radius={22} /></div>
        <div style={{ fontSize: 16, fontWeight: 700, color: colors.ink, marginBottom: 8 }}>This account isn't set up yet</div>
        <p style={{ fontSize: 13.5, color: colors.inkSoft, lineHeight: 1.55, margin: "0 0 18px" }}>
          {email} doesn't have a role in Strovia. Register with a Company ID, or ask your administrator for a family invitation link.
        </p>
        <button onClick={onSignOut} style={{ width: "100%", padding: 11, borderRadius: 9, border: `1px solid ${colors.hairline}`, background: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600, color: colors.ink }}>
          Log out
        </button>
      </div>
    </div>
  )
}


// Records the sign-out for the administrator's audit trail, then signs out. Logging never blocks signing out.
async function endSession(reason) {
  try { await supabase.rpc("log_session_end", { p_reason: reason }) } catch { /* audit logging is best effort */ }
  forgetLastActivity()
  await supabase.auth.signOut()
}

// Health data warrants a shorter auto-logout than a typical consumer app —
// 10 minutes of inactivity, matching common patient-portal defaults, with a
// 2-minute warning so an in-progress check-in isn't silently discarded.
//
// The time of the last activity is kept on the device and compared with the clock. A countdown timer alone is not
// enough: phones freeze timers when the screen locks or the app is in the background, and a closed tab keeps its
// login, so the person would come back still signed in. Every time the app is looked at again, the clock decides.
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000
const INACTIVITY_WARNING_MS = 8 * 60 * 1000
const ACTIVITY_EVENTS = ["mousedown", "keydown", "touchstart", "scroll", "wheel"]
const ACTIVITY_KEY = "strovia-last-activity"
const CHECK_EVERY_MS = 10 * 1000

const readLastActivity = () => {
  try {
    const t = Number(localStorage.getItem(ACTIVITY_KEY))
    return Number.isFinite(t) && t > 0 ? t : null
  } catch { return null }
}
const writeLastActivity = (t) => { try { localStorage.setItem(ACTIVITY_KEY, String(t)) } catch { /* storage blocked: the in-memory time is used */ } }
const forgetLastActivity = () => { try { localStorage.removeItem(ACTIVITY_KEY) } catch { /* nothing to forget */ } }

const CLOCK_SKEW_MS = 2 * 60 * 1000 // the phone's clock and the server's can differ a little

// `signedInAt` is when this login started: an activity time older than that belongs to an earlier session.
function useInactivityLogout(active, signedInAt, onWarn, onTimeout, onActive) {
  const lastRef = useRef(Date.now())
  const signingOut = useRef(false)

  const mark = useCallback((force = false) => {
    const t = Date.now()
    if (!force && t - lastRef.current < 1000) return // scrolling fires many events; once a second is plenty
    lastRef.current = t
    writeLastActivity(t)
    onActive()
  }, [onActive])

  const check = useCallback(() => {
    if (signingOut.current) return
    // The stored time is shared by every open tab, so activity in any of them counts. If storage is blocked,
    // the time kept in memory is used instead.
    const last = readLastActivity() ?? lastRef.current
    const idle = Date.now() - last
    if (idle >= INACTIVITY_TIMEOUT_MS) {
      signingOut.current = true
      onTimeout()
    } else if (idle >= INACTIVITY_WARNING_MS) {
      onWarn()
    }
  }, [onWarn, onTimeout])

  useEffect(() => {
    if (!active) return
    signingOut.current = false
    // A login that was left open (or a tab that was closed and reopened) carries its old time; a new login has none.
    const stored = readLastActivity()
    if (stored === null || (signedInAt && stored < signedInAt - CLOCK_SKEW_MS)) {
      lastRef.current = Date.now()
      writeLastActivity(lastRef.current)
    } else lastRef.current = stored
    check()

    const onVisible = () => { if (document.visibilityState === "visible") check() }
    const onActivity = () => mark()
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, onActivity, { passive: true }))
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("focus", check)
    window.addEventListener("pageshow", check)
    window.addEventListener("online", check)
    const timer = setInterval(check, CHECK_EVERY_MS)
    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, onActivity))
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("focus", check)
      window.removeEventListener("pageshow", check)
      window.removeEventListener("online", check)
      clearInterval(timer)
    }
  }, [active, signedInAt, check, mark])

  return useCallback(() => mark(true), [mark])
}

// Landing after the emailed verification link: the link signs the person in, but
// the portal is entered by logging in with the Company ID, so we sign out again.
function readVerifiedLanding() {
  const params = new URLSearchParams(window.location.search)
  if (params.get("verified") !== "staff") return null
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""))
  const failure = hash.get("error_description") || params.get("error_description")
  return failure
    ? { type: "error", text: "That verification link is invalid or has expired. Register again or use \"Resend email\" to get a new one." }
    : { type: "success", text: "Your email is verified. Log in below with your Company ID and password." }
}

function Root() {
  const [session, setSession] = useState(undefined) // undefined = still loading
  const [verifiedBanner, setVerifiedBanner] = useState(readVerifiedLanding)
  const verifiedLanding = useRef(verifiedBanner !== null)
  const [showPassword, setShowPassword] = useState(false)
  const [recovery, setRecovery] = useState(false)
  const [newPassword, setNewPassword] = useState("")
  const [newPasswordError, setNewPasswordError] = useState(null)
  const [newPasswordBusy, setNewPasswordBusy] = useState(false)
  const [newPasswordDone, setNewPasswordDone] = useState(false)
  const [showTimeoutWarning, setShowTimeoutWarning] = useState(false)
  const [joinToken] = useState(() => new URLSearchParams(window.location.search).get("join"))
  const [member, setMember] = useState(undefined) // undefined = loading, null = signed in but has no role yet
  const [memberCheck, setMemberCheck] = useState(0)

  const handleWarn = useCallback(() => setShowTimeoutWarning(true), [])
  const handleActive = useCallback(() => setShowTimeoutWarning(false), [])
  const handleTimeout = useCallback(() => {
    setShowTimeoutWarning(false)
    endSession("Signed out automatically after 10 minutes of inactivity")
  }, [])
  const signedInAt = session?.user?.last_sign_in_at ? Date.parse(session.user.last_sign_in_at) : 0
  const resetInactivityTimer = useInactivityLogout(!!session && !recovery, signedInAt, handleWarn, handleTimeout, handleActive)

  // Nobody is signed in: forget the old activity time, so the next login starts fresh.
  useEffect(() => { if (session === null) forgetLastActivity() }, [session])

  useEffect(() => {
    // Returns true if this session came from the verification link and was signed out again.
    function bounceVerifiedLanding(s) {
      if (!s || !verifiedLanding.current) return false
      verifiedLanding.current = false
      window.history.replaceState({}, "", window.location.pathname)
      setTimeout(() => supabase.auth.signOut(), 0)
      return true
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(bounceVerifiedLanding(data.session) ? null : data.session)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true)
      setSession(bounceVerifiedLanding(s) ? null : s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session) setVerifiedBanner(null)
  }, [session])

  useEffect(() => {
    if (!session) {
      setMember(undefined)
      return
    }
    let cancelled = false
    supabase
      .from("staff_accounts")
      .select("role, approved, company_id, organisation, first_name, last_name, job_title, phone, avatar_path, birthday_month, birthday_day, details_edited_at, email_message_notices")
      .eq("user_id", session.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!cancelled) setMember(!error && data ? data : null)
      })
    return () => { cancelled = true }
  }, [session, memberCheck])

  if (session === undefined) {
    return null // brief loading flash, avoids showing the login form incorrectly
  }

  if (joinToken) {
    return <JoinPage token={joinToken} session={session} onSignOut={() => supabase.auth.signOut()} />
  }

  if (recovery) {
    return (
      <div style={{
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", background: colors.bg, padding: 16,
      }}>
        <div style={{ background: "#fff", padding: 32, borderRadius: 18, width: 340, boxSizing: "border-box", boxShadow: "0 1px 3px rgba(32,38,31,0.06), 0 6px 16px rgba(32,38,31,0.05)" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 20 }}>
            <div style={{ marginBottom: 10 }}><LogoMark size={52} radius={22} /></div>
            <div style={{ fontSize: 15, fontWeight: 700, color: colors.ink }}>Set a new password</div>
            <div style={{ fontSize: 13, color: colors.inkFaint, textAlign: "center", marginTop: 4 }}>
              Choose a new password for your Strovia account.
            </div>
          </div>
          {newPasswordDone ? (
            <>
              <p style={{ fontSize: 13.5, color: colors.ink, textAlign: "center" }}>Password updated.</p>
              <button
                onClick={() => setRecovery(false)}
                style={{ width: "100%", padding: 11, borderRadius: 8, border: "none", background: colors.sage, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 14.5 }}
              >
                Continue to Strovia
              </button>
            </>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault()
                setNewPasswordError(null)
                if (newPassword.length < 8) { setNewPasswordError("Password must be at least 8 characters."); return }
                setNewPasswordBusy(true)
                const { error } = await supabase.auth.updateUser({ password: newPassword })
                setNewPasswordBusy(false)
                if (error) setNewPasswordError(error.message)
                else setNewPasswordDone(true)
              }}
            >
              <label style={{ fontSize: 13, fontWeight: 600, color: colors.ink, display: "block", marginBottom: 5 }}>New password</label>
              <div style={{ position: "relative", marginBottom: 6 }}>
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  style={{ width: "100%", padding: "10px 38px 10px 10px", borderRadius: 8, border: `1px solid ${colors.hairline}`, boxSizing: "border-box", fontSize: 14 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", border: "none", background: "none", cursor: "pointer", padding: 4, display: "flex", color: colors.inkFaint }}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              <div style={{ marginBottom: 14, minHeight: 16 }}>
                {(() => {
                  const strength = passwordStrength(newPassword)
                  if (!strength) {
                    return <span style={{ fontSize: 12.5, color: colors.inkFaint }}>Use at least 8 characters — mix in a number or symbol for a stronger password.</span>
                  }
                  return <span style={{ fontSize: 12.5, fontWeight: 700, color: strength.color }}>Password strength: {strength.label}</span>
                })()}
              </div>
              <button type="submit" disabled={newPasswordBusy} style={{ width: "100%", padding: 11, borderRadius: 8, border: "none", background: colors.sage, color: "#fff", fontWeight: 700, cursor: newPasswordBusy ? "default" : "pointer", opacity: newPasswordBusy ? 0.7 : 1, fontSize: 14.5 }}>
                {newPasswordBusy ? "Please wait..." : "Set new password"}
              </button>
              {newPasswordError && <p style={{ color: colors.rust, fontSize: 13, marginTop: 10, marginBottom: 0 }}>{newPasswordError}</p>}
            </form>
          )}
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div style={{
        minHeight: "100vh", display: "flex", justifyContent: "center",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        background: "linear-gradient(160deg, #FBF8F2 0%, #F5EFE3 45%, #E9EFE6 100%)",
        padding: "56px 20px",
      }}>
        <div className="landing-grid" style={{ width: "100%", maxWidth: 1040 }}>
          {/* Brand */}
          <div className="landing-brand">
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 14 }}>
              <div style={{ borderRadius: 16, boxShadow: "0 2px 8px rgba(63,108,81,0.25)", lineHeight: 0 }}><LogoMark size={60} radius={22} /></div>
              <span style={{ fontFamily: "Georgia, serif", fontSize: 46, fontWeight: 600, color: colors.sageDeep, letterSpacing: -0.5 }}>Strovia</span>
            </div>
            <p style={{ fontSize: 21, fontWeight: 600, color: colors.ink, margin: "0 0 10px", lineHeight: 1.3 }}>
              Your stroke recovery monitoring companion
            </p>
            <p className="landing-lede" style={{ fontSize: 15.5, color: colors.inkSoft, margin: "0 0 40px", lineHeight: 1.6, maxWidth: 480 }}>
              Follow a stroke survivor's care plan, track their symptoms and watch their recovery, day by day.
            </p>
          </div>

          {/* What it does */}
          <div className="landing-features">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "30px 24px" }}>
              {FEATURES.map((f) => (
                <div key={f.title} style={{ display: "flex", gap: 14 }}>
                  <div style={{ width: 50, height: 50, borderRadius: 14, background: f.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: `0 3px 10px ${f.color}40` }}>
                    <f.icon size={23} color="#fff" />
                  </div>
                  <div>
                    <div style={{ fontSize: 16.5, fontWeight: 700, color: colors.ink, marginBottom: 3 }}>{f.title}</div>
                    <div style={{ fontSize: 13.5, color: colors.inkFaint, lineHeight: 1.5 }}>{f.text}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sign in / sign up card */}
          <div className="landing-auth">
            <AuthCard banner={verifiedBanner} />
          </div>
        </div>
      </div>
    )
  }

  if (member === undefined) {
    return null // brief loading flash while we look up this account's role
  }

  return (
    <>
      {member === null ? (
        <NoAccess email={session.user.email} onSignOut={() => endSession("Logged out")} />
      ) : !member.approved ? (
        <AwaitingApproval
          name={member.first_name}
          onCheckAgain={() => { setMember(undefined); setMemberCheck((n) => n + 1) }}
          onSignOut={() => endSession("Logged out")}
        />
      ) : (member.role === "admin" || member.role === "caregiver") && !member.birthday_month ? (
        <BirthdayGate
          member={member}
          onSaved={(patch) => setMember((m) => ({ ...m, ...patch }))}
          onSignOut={() => endSession("Logged out")}
        />
      ) : (
        <App
          userEmail={session.user.email}
          userId={session.user.id}
          member={member}
          onMemberUpdated={(patch) => setMember((m) => ({ ...m, ...patch }))}
          onSignOut={() => endSession("Logged out")}
        />
      )}
      {showTimeoutWarning && (
        <div style={{
          position: "fixed", bottom: 90, left: 16, right: 16, maxWidth: 420, margin: "0 auto",
          background: colors.ink, color: "#fff", borderRadius: 14, padding: "14px 16px",
          boxShadow: "0 6px 20px rgba(0,0,0,0.25)", zIndex: 50,
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <span style={{ fontSize: 13, flex: 1, lineHeight: 1.4 }}>
            You'll be signed out in 2 minutes due to inactivity.
          </span>
          <button
            onClick={() => { setShowTimeoutWarning(false); resetInactivityTimer() }}
            style={{ flexShrink: 0, padding: "8px 14px", borderRadius: 8, border: "none", background: colors.sage, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
          >
            Stay signed in
          </button>
        </div>
      )}
    </>
  )
}

applyTextSize()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
    <UpdateBanner />
  </StrictMode>,
)

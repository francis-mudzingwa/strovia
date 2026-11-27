import { useEffect, useState } from "react"

// Tells people when a newer version of Strovia has been published, so nobody keeps working on an old page. Every build has an
// id (`__BUILD_ID__`, set in vite.config.js) and publishes it as /version.json. This page compares its own id with the file on
// the server when it opens, when someone comes back to it, and every five minutes. Nothing reloads by itself: a person in the
// middle of a check-in chooses when to update. Not shown while developing.
const CHECK_EVERY_MS = 5 * 60 * 1000
const LATER_MS = 30 * 60 * 1000

export default function UpdateBanner() {
  const [ready, setReady] = useState(false)
  const [laterUntil, setLaterUntil] = useState(0)

  useEffect(() => {
    if (!import.meta.env.PROD) return undefined
    let stopped = false
    async function check() {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" })
        if (!res.ok) return
        const data = await res.json()
        if (!stopped && data && data.id && data.id !== __BUILD_ID__) setReady(true)
      } catch { /* offline or blocked: try again later */ }
    }
    const onVisible = () => { if (document.visibilityState === "visible") check() }
    document.addEventListener("visibilitychange", onVisible)
    const timer = setInterval(check, CHECK_EVERY_MS)
    check()
    return () => { stopped = true; document.removeEventListener("visibilitychange", onVisible); clearInterval(timer) }
  }, [])

  if (!ready || Date.now() < laterUntil) return null
  return (
    <div role="status" className="no-print" style={{ position: "fixed", top: 10, left: 12, right: 12, maxWidth: 520, margin: "0 auto", zIndex: 50, background: "#2C4E3A", color: "#fff", borderRadius: 14, padding: "11px 14px", boxShadow: "0 6px 20px rgba(32,38,31,0.25)", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 200px", minWidth: 0, fontSize: 13.5, lineHeight: 1.4 }}>
        <strong>A new version of Strovia is ready.</strong> Finish what you are doing first, then tap Update.
      </div>
      <button onClick={() => window.location.reload()} style={{ border: "none", borderRadius: 10, background: "#E8BE5E", color: "#20261F", fontWeight: 700, fontSize: 13.5, padding: "8px 14px", cursor: "pointer" }}>Update</button>
      <button onClick={() => setLaterUntil(Date.now() + LATER_MS)} style={{ border: "none", background: "none", color: "#D9E4DC", fontWeight: 600, fontSize: 13, padding: "8px 4px", cursor: "pointer", textDecoration: "underline" }}>Later</button>
    </div>
  )
}

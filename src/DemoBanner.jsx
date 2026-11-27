// A thin strip shown only on the public try-it copy of the app (built with VITE_DEMO=true), so nobody mistakes it for the real thing.
import { useEffect } from "react"

export const IS_DEMO =import.meta.env.VITE_DEMO === "true"

// When the demo runs inside the portfolio's phone frame, tell the page the app is up, so its "signing you in" cover can lift.
export function DemoReadySignal() {
  useEffect(() => {
    try { if (IS_DEMO && window.parent !== window) window.parent.postMessage({ strovia: "ready" }, "*") } catch { /* not framed */ }
  }, [])
  return null
}

export default function DemoBanner() {
  if (!IS_DEMO) return null
  // Inside the portfolio's phone frame the page around it already says it is a demo, so the strip would only waste space.
  try { if (window.self !== window.top) return null } catch { return null }
  return (
    <div
      role="note"
      style={{
        background: "#2C4E3A", color: "#fff", textAlign: "center", fontSize: 13, lineHeight: 1.4, padding: "7px 12px",
      }}
    >
      Demo with made-up sample data. Nothing here is real, and it resets every night.{" "}
      <a href="https://strovia-app.netlify.app/portfolio/" style={{ color: "#fff", textDecoration: "underline", whiteSpace: "nowrap" }}>
        Back to the portfolio
      </a>
    </div>
  )
}

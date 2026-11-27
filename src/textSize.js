// Larger text for people who find the app hard to read. It scales the whole screen and is remembered on this device.
const KEY = "strovia-text-size"
export const SIZES = [
  { key: "standard", label: "Standard", zoom: 1 },
  { key: "large", label: "Large", zoom: 1.15 },
  { key: "xlarge", label: "Extra large", zoom: 1.3 },
]

export function getTextSize() {
  try {
    const saved = localStorage.getItem(KEY)
    return SIZES.some((s) => s.key === saved) ? saved : "standard"
  } catch { return "standard" }
}

export function applyTextSize(key = getTextSize()) {
  const size = SIZES.find((s) => s.key === key) || SIZES[0]
  document.documentElement.style.zoom = size.zoom === 1 ? "" : String(size.zoom)
}

export function setTextSize(key) {
  try { localStorage.setItem(KEY, key) } catch { /* private mode: it just will not be remembered */ }
  applyTextSize(key)
}

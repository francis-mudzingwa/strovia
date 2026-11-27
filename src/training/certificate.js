const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
const long = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })

// A printable certificate of completion (print it, or choose "Save as PDF" in the print window). Everything on it is copied
// onto the certificate when it is issued, so it never changes afterwards. Returns false if the browser blocked the window.
export function printCertificate(c) {
  const w = window.open("", "_blank")
  if (!w) return false
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Certificate ${esc(c.number)}</title>
<style>
  @page { size: letter landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Georgia, "Times New Roman", serif; color: #20261F; }
  .page { border: 3px double #B98A2E; padding: 38px 56px; min-height: 175mm; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
  .brand { font-size: 22px; font-weight: 700; color: #2C4E3A; letter-spacing: 1px; }
  .kicker { margin-top: 26px; font-size: 14px; letter-spacing: 5px; color: #B98A2E; font-weight: 700; font-family: Arial, sans-serif; }
  .small { font-size: 17px; color: #5C6357; margin-top: 26px; }
  .name { font-size: 44px; color: #2C4E3A; margin: 10px 0 6px; }
  .title { font-size: 30px; margin: 8px 0; }
  .meta { font-size: 16px; color: #5C6357; margin-top: 6px; }
  .foot { display: flex; justify-content: space-between; width: 100%; margin-top: 56px; border-top: 1px solid #E5DFD1; padding-top: 14px; font-size: 14px; color: #5C6357; font-family: Arial, sans-serif; text-align: left; }
  .foot b { color: #20261F; font-size: 16px; }
</style></head><body>
<div class="page">
  <div class="brand">Strovia</div>
  <div class="kicker">CERTIFICATE OF COMPLETION</div>
  <div class="small">This certifies that</div>
  <div class="name">${esc(c.holder_name)}</div>
  <div class="small" style="margin-top:6px">has completed the training</div>
  <div class="title">${esc(c.training_title)}</div>
  <div class="meta">on ${esc(long(c.issued_on))}</div>
  ${c.valid_until ? `<div class="meta">Valid until ${esc(long(c.valid_until))}</div>` : ""}
  <div class="foot">
    <div>Issued by<br><b>${esc(c.issuer_name)}</b></div>
    <div style="text-align:right">Certificate number<br><b>${esc(c.number)}</b></div>
  </div>
</div>
</body></html>`)
  w.document.close()
  w.focus()
  w.print()
  return true
}

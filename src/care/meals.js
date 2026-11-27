// The meals log. Strovia sets no targets: it only records how much was eaten and drunk, and whether there was trouble swallowing.
// Lunch opens at 12 noon and dinner at 5 PM (the database enforces the same rule in Eastern time); only an administrator can
// record one early, with a reason.
export const MEALS = [
  { key: "breakfast", label: "Breakfast", opens: 0 },
  { key: "lunch", label: "Lunch", opens: 12 },
  { key: "dinner", label: "Dinner", opens: 17 },
]
export const AMOUNTS = [["all", "All of it"], ["most", "Most of it"], ["half", "About half"], ["little", "A little"], ["none", "None"]]
export const DRINKS = [["well", "Drank well"], ["some", "Drank some"], ["little", "Drank very little"]]

export const mealLabel = (k) => MEALS.find((m) => m.key === k)?.label || k
export const amountLabel = (k) => AMOUNTS.find(([v]) => v === k)?.[1] || k
export const drinksLabel = (k) => DRINKS.find(([v]) => v === k)?.[1] || k

// "Ate most of it, drank well"
export const summary = (row) => `Ate ${amountLabel(row.amount).toLowerCase()}, ${drinksLabel(row.drinks).toLowerCase()}`

// The meals that are open at this moment on this device's clock (breakfast always, lunch from noon, dinner from 5 PM).
export const openMeals = (now = new Date()) => MEALS.filter((m) => now.getHours() >= m.opens)

// What was recorded for a meal on a day (rows are the log rows for that patient).
export const mealRow = (rows, date, meal) => (rows || []).find((r) => r.log_date === date && r.meal === meal) || null

// Things worth passing on in a handover: little or nothing eaten, very little drunk, trouble swallowing.
export function mealConcerns(rows, date) {
  const out = []
  for (const m of MEALS) {
    const r = mealRow(rows, date, m.key)
    if (!r) continue
    if (r.trouble) out.push({ tone: "bad", title: `Trouble swallowing was reported at ${m.label.toLowerCase()}`, detail: "Coughing, choking or trouble swallowing. Worth telling the office." })
    if (r.amount === "none") out.push({ tone: "warn", title: `Ate none of ${m.label.toLowerCase()}`, detail: r.note || undefined })
    else if (r.amount === "little") out.push({ tone: "warn", title: `Ate only a little at ${m.label.toLowerCase()}`, detail: r.note || undefined })
    if (r.drinks === "little") out.push({ tone: "warn", title: `Drank very little at ${m.label.toLowerCase()}` })
  }
  return out
}
